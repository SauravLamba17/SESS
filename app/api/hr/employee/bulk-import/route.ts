import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { onboardEmployee } from "@/lib/employees/onboard";
import { validateCsv, type ValidationContext } from "@/lib/employees/csv-import";
import { withPrivilegedRoute } from "@/lib/mfa-guard";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CSV_BYTES = 1024 * 1024; // 1 MB — thousands of rows, not a data dump
const MAX_ROWS = 1000;

/**
 * Bulk employee import from CSV.
 *
 * TWO MODES, driven by `mode`:
 *   "preview"  — parse + validate, return the verdict, write NOTHING.
 *   "commit"   — re-validate from scratch, then create the valid rows.
 *
 * Commit RE-VALIDATES rather than trusting a preview token, because the
 * database can change between the two calls: another HR user may have
 * onboarded a clashing employeeCode, or deactivated the manager a row
 * references. Trusting the earlier verdict would let a stale preview write
 * rows that are no longer valid.
 *
 * ── STRATEGY: ALL-OR-NOTHING ──────────────────────────────────────────
 * If ANY row is invalid, nothing is written and HR gets the full reason list.
 * If every row is valid, all are created inside ONE transaction — so a failure
 * partway through rolls the whole batch back.
 *
 * Chosen over per-row-with-report because a payroll-bearing roster half-loaded
 * is worse than one not loaded at all: HR cannot easily tell which half landed,
 * re-running duplicates the successful half, and the employeeCode uniqueness
 * check that made the file valid is invalidated mid-run. An import that either
 * fully succeeds or fully fails is one HR can reason about and simply re-run
 * after fixing the file.
 *
 * Every created employee still gets its own EMPLOYEE_ONBOARDED audit row from
 * the shared onboardEmployee(), plus one BULK_EMPLOYEE_IMPORT row summarising
 * the batch.
 */
async function POSTHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may import employees", 403);

  let body: { mode?: unknown; csv?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const mode = body.mode === "commit" ? "commit" : "preview";
  const csv = typeof body.csv === "string" ? body.csv : "";
  if (!csv.trim()) return fail("BAD_INPUT", "No CSV content was provided.", 400);
  if (Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES)
    return fail("TOO_LARGE", "CSV must be 1 MB or smaller.", 400);

  try {
    // Context for validation — two queries, regardless of file size.
    const [existing, activeManagers] = await Promise.all([
      db.employee.findMany({ select: { employeeCode: true, email: true } }),
      db.employee.findMany({
        where: { active: true },
        select: { id: true, employeeCode: true },
      }),
    ]);

    const ctx: ValidationContext = {
      existingCodes: new Set(existing.map((e) => e.employeeCode)),
      activeManagerCodes: new Map(activeManagers.map((m) => [m.employeeCode, m.id])),
      existingEmails: new Set(
        existing.flatMap((e) => (e.email ? [e.email.toLowerCase()] : [])),
      ),
    };

    const result = validateCsv(csv, ctx);
    if (result.fatal) return fail("BAD_CSV", result.fatal, 400);

    const totalRows = result.valid.length + result.invalid.length;
    if (totalRows > MAX_ROWS)
      return fail(
        "TOO_MANY_ROWS",
        `This file has ${totalRows} rows; the limit is ${MAX_ROWS} per import. Split it into smaller files.`,
        400,
      );

    const preview = {
      totalRows,
      validCount: result.valid.length,
      invalidCount: result.invalid.length,
      valid: result.valid.map((r) => ({
        lineNumber: r.lineNumber,
        employeeCode: r.employeeCode,
        name: r.name,
        department: r.department,
        designation: r.designation,
        managerEmployeeCode: r.managerEmployeeCode,
        joiningDate: r.joiningDate!.toISOString().slice(0, 10),
        machineId: r.machineId,
        email: r.email,
      })),
      invalid: result.invalid,
    };

    // ── PREVIEW: nothing is written, ever ──
    if (mode === "preview") {
      return NextResponse.json({ ok: true, mode: "preview", ...preview });
    }

    // ── COMMIT ──
    if (result.invalid.length > 0)
      return NextResponse.json(
        {
          error: `${result.invalid.length} of ${totalRows} row(s) are invalid. Nothing was imported — fix the file and try again.`,
          code: "INVALID_ROWS",
          ...preview,
        },
        { status: 409 },
      );

    if (result.valid.length === 0)
      return fail("NO_ROWS", "There are no rows to import.", 400);

    const created = await db.$transaction(
      async (tx) => {
        const out: { employeeCode: string; id: string; name: string }[] = [];

        for (const row of result.valid) {
          // THE SAME shared function HR's single-employee onboarding uses, and
          // the same one Phase 8's hire-conversion calls.
          const res = await onboardEmployee(
            tx,
            {
              employeeCode: row.employeeCode,
              name: row.name,
              department: row.department,
              designation: row.designation,
              // Resolved code → internal id; the CSV references by code.
              managerId: row.managerEmployeeCode
                ? (ctx.activeManagerCodes.get(row.managerEmployeeCode) ?? null)
                : null,
              machineId: row.machineId,
              joiningDate: row.joiningDate!,
              // Stored only — invitations are sent later, per-employee, from
              // the roster. Mass-inviting an entire import is never implicit.
              email: row.email,
            },
            userId,
          );

          // Aborts the whole transaction — all-or-nothing.
          if (!res.ok)
            throw new Error(`ROW_FAILED:${row.lineNumber}:${row.employeeCode}:${res.message}`);

          out.push({
            id: res.employee.id,
            employeeCode: res.employee.employeeCode,
            name: res.employee.name,
          });
        }

        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: "BULK_EMPLOYEE_IMPORT",
            targetEntity: `${out.length} employees imported: ${out.map((o) => o.employeeCode).join(", ")}`,
          },
        });

        return out;
      },
      { timeout: 60_000 },
    );

    return NextResponse.json({
      ok: true,
      mode: "commit",
      imported: created.length,
      employees: created,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("ROW_FAILED:")) {
      const [, line, code, ...rest] = err.message.split(":");
      return fail(
        "ROW_FAILED",
        `Import rolled back — nothing was created. Row on line ${line} (${code}) failed: ${rest.join(":")}`,
        409,
      );
    }
    console.error("[hr/employee/bulk-import] failed:", err);
    return fail("SERVER_ERROR", "Could not import employees", 503);
  }
}

// MFA gate — see lib/mfa-guard.ts. Rejects only when the caller's role
// requires two-factor auth and it is not enabled; every other status this
// route returns is produced by the handler above, unchanged.
export const POST = withPrivilegedRoute(POSTHandler);
