import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { financialYearMonths } from "@/lib/period";
import { renderForm16 } from "@/lib/payroll/pdf";
import { withPrivilegedRoute } from "@/lib/mfa-guard";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Form 16 Part B for one employee and one financial year (April–March).
 *
 * This is an AGGREGATION AND FORMATTING endpoint, nothing more: it sums the
 * gross and TDS already stored on FINALIZED payroll rows and lays them out.
 * It computes no tax, applies no slab, and grants no exemption — the TDS
 * figures were entered by HR from the company's CA.
 *
 * FINALIZED rows only. A partial year is labelled as partial in the document;
 * missing months are never estimated or fabricated.
 *
 * MFA-gated: HR/Super Admin may request ANY employee's annual earnings and TDS
 * via ?employeeId. The wrapper only blocks a role that requires MFA, so an
 * employee fetching their own Form 16 is unaffected.
 */
async function GETHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);

  const url = new URL(req.url);
  const fy = (url.searchParams.get("fy") ?? "").trim();
  const requestedEmployeeId = (url.searchParams.get("employeeId") ?? "").trim();

  const months = financialYearMonths(fy);
  if (!months)
    return fail(
      "BAD_INPUT",
      "fy must be a financial year label such as 2026-27",
      400,
    );

  try {
    const role = await getCurrentRole();
    const isPrivileged = role === "HR" || role === "SUPER_ADMIN";

    // Scope: HR may request anyone; everyone else gets their own, always.
    let employeeId: string;
    if (isPrivileged && requestedEmployeeId) {
      employeeId = requestedEmployeeId;
    } else {
      const me = await getEmployeeByClerkId(userId);
      if (!me)
        return fail("NO_EMPLOYEE", "No employee record linked to this account", 403);
      if (requestedEmployeeId && requestedEmployeeId !== me.id)
        return fail("FORBIDDEN", "You may only download your own Form 16", 403);
      employeeId = me.id;
    }

    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, name: true, employeeCode: true, department: true },
    });
    if (!employee) return fail("NOT_FOUND", "Employee not found", 404);

    // One query for the whole year — the 12 period strings are an indexed IN.
    const rows = await db.payroll.findMany({
      where: { employeeId, status: "FINALIZED", month: { in: months } },
      select: {
        month: true,
        gross: true,
        tds: true,
        tdsSource: true,
        pfEmployee: true,
        professionalTax: true,
        adjustmentForPayrollId: true,
      },
      orderBy: [{ month: "asc" }, { finalizedAt: "asc" }],
    });

    if (rows.length === 0)
      return fail(
        "NO_FINALIZED_DATA",
        `No finalized payroll exists for ${employee.name} in FY ${fy}. Form 16 can only be generated from finalized runs.`,
        409,
      );

    const zero = new Prisma.Decimal(0);
    const totalGross = rows.reduce((a, r) => a.plus(r.gross), zero);
    const totalTds = rows.reduce((a, r) => a.plus(r.tds), zero);
    const totalPf = rows.reduce((a, r) => a.plus(r.pfEmployee), zero);
    const totalPt = rows.reduce((a, r) => a.plus(r.professionalTax), zero);

    const pdf = await renderForm16({
      employeeName: employee.name,
      employeeCode: employee.employeeCode,
      department: employee.department,
      financialYear: fy,
      // Adjustment rows carry DELTAS, so summing every finalized row gives the
      // correct annual total automatically — no special-casing. They are
      // flagged only so the month-wise table doesn't show two unexplained
      // entries for the same month.
      months: rows.map((r) => ({
        month: r.month,
        gross: r.gross.toFixed(2),
        tds: r.tds.toFixed(2),
        isAdjustment: r.adjustmentForPayrollId !== null,
      })),
      totalGross: totalGross.toFixed(2),
      totalTds: totalTds.toFixed(2),
      totalPf: totalPf.toFixed(2),
      totalProfessionalTax: totalPt.toFixed(2),
      tdsSources: Array.from(
        new Set(rows.map((r) => r.tdsSource).filter((x): x is string => !!x)),
      ),
      // Count DISTINCT months, not rows — a month with a correction has two
      // finalized rows but is still one month of employment.
      monthsCovered: new Set(rows.map((r) => r.month)).size,
      partial: new Set(rows.map((r) => r.month)).size < 12,
      generatedAt: new Date(),
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="form16-partB-${employee.employeeCode}-FY${fy}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[form16] failed:", err);
    return fail("SERVER_ERROR", "Could not generate the Form 16 statement", 503);
  }
}

export const GET = withPrivilegedRoute(GETHandler);
