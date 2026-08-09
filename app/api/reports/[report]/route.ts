import { NextResponse, type NextRequest } from "next/server";
import { REPORT_BY_ID, type ReportId } from "@/lib/reports/registry";
import { resolveReportScope } from "@/lib/reports/scope";
import { parseRange } from "@/lib/reports/range";
import { runReport } from "@/lib/reports/run";
import { serializeCsv } from "@/lib/reports/csv";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reports/{report-name}?startDate=&endDate=&format=pdf|csv|json
 *
 * ONE handler behind a dynamic segment rather than ten near-identical route
 * files. The URLs are exactly the ten specified — /api/reports/headcount,
 * /api/reports/payroll-cost, … — and each report still has exactly one
 * definition, in lib/reports/run.tsx. What is NOT duplicated ten times is the
 * auth check, the scope resolution, the range validation and the PDF response:
 * a scoping rule that exists in one place cannot drift between nine copies and
 * a tenth, which is the failure this shape exists to prevent.
 *
 * ORDER OF CHECKS, deliberately: unknown report → 404 before anything else;
 * then AUTH + SCOPE (403 for every "no access" cell in the registry's table,
 * enforced here on the server, never by the UI hiding a card); then the range.
 *
 * Generated synchronously, on request. There is no queue, no cache and no
 * scheduled delivery — see the note in the phase report; at this data volume a
 * report is a handful of set-based queries and a render, and adding
 * infrastructure for a scale problem that does not exist would be the mistake.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { report: string } },
) {
  const def = REPORT_BY_ID.get(params.report);
  if (!def) return fail("UNKNOWN_REPORT", `There is no report called "${params.report}"`, 404);

  try {
    // Auth + scope. Returns 403 for every no-access cell, and for any EMPLOYEE.
    const scope = await resolveReportScope(def);
    if (!scope.ok) return fail(scope.code, scope.message, scope.status);

    const { searchParams } = new URL(req.url);
    const parsed = parseRange(searchParams.get("startDate"), searchParams.get("endDate"));
    if (!parsed.ok) return fail(parsed.code, parsed.message, 400);
    const range = parsed.range;

    const generatedAt = new Date();
    const meta = {
      title: def.title,
      startLabel: range.startLabel,
      endLabel: range.endLabel,
      generatedBy: scope.generatedBy,
      generatedAt,
      scopeLabel: scope.scopeLabel,
    };

    // ONE compute pass. Whichever format is requested below renders THIS
    // result — the CSV and the PDF are never two calculations.
    const run = await runReport(def.id as ReportId, scope, range, meta);

    // JSON preview — same numbers, no render. Useful for an on-screen preview
    // and for anything that wants the figures rather than the document.
    if (searchParams.get("format") === "json") {
      return NextResponse.json({
        ok: true,
        report: def.id,
        title: def.title,
        scope: scope.scopeLabel,
        range: { startDate: range.startLabel, endDate: range.endLabel, days: range.days },
        result: run.result,
      });
    }

    if (searchParams.get("format") === "csv") {
      if (!run.csv)
        return fail(
          "NO_CSV",
          `${def.title} is available as PDF only — its detail is downloadable from the individual reports.`,
          400,
        );
      const csv = serializeCsv(run.csv(), meta);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${def.id}-${range.startLabel}-to-${range.endLabel}.csv"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    const pdf = await run.pdf();
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${def.id}-${range.startLabel}-to-${range.endLabel}.pdf"`,
        // A report can carry salary and disciplinary data — never cached by a
        // proxy or written to a shared disk cache.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error(`[reports/${params.report}] failed:`, err);
    return fail("SERVER_ERROR", "Could not generate the report", 503);
  }
}
