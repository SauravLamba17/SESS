import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { fail } from "@/lib/api/response";
import {
  checkEligibility,
  redactionPatch,
  addYears,
  EXTENSION_YEARS,
  REDACTED_FIELDS,
} from "@/lib/employees/retention";
import { ymd } from "@/lib/reports/range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retention actions on an offboarded employee past their redaction date.
 *
 * `redact` overwrites DIRECT PERSONAL IDENTIFIERS on the Employee row and
 * nothing else. It does not delete the Employee row, and it does not touch a
 * single related table — no Payroll, Attendance, AppraisalScore, WarningLetter,
 * ExpenseClaim, SalaryStructure or anything else. Those records are the reason
 * the retention period exists and are kept permanently and queryable.
 *
 * This is deliberately NOT the candidate-deletion flow in
 * app/api/hr/candidate/retention — see the header of lib/employees/retention.ts
 * for why a former employee and a rejected candidate are different cases.
 *
 * `extend` pushes the date out when there is a live legal or audit reason to
 * hold the full record longer.
 */
export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may act on employee retention", 403);

  let body: { action?: unknown; employeeId?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const action = typeof body.action === "string" ? body.action : "";
  const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!employeeId) return fail("BAD_INPUT", "employeeId is required", 400);
  if (action !== "redact" && action !== "extend")
    return fail("BAD_INPUT", "action must be 'redact' or 'extend'", 400);

  // Both actions are consequential and one-way, so both demand a written
  // reason — the same rule the candidate retention flow applies to extensions.
  if (!reason)
    return fail(
      "BAD_INPUT",
      action === "redact"
        ? "A written reason is required. Redaction is irreversible — record why this employee's personal identifiers are being erased now."
        : "A written reason is required — record why this employee's full record must be kept beyond the retention period.",
      400,
    );

  try {
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        name: true,
        employeeCode: true,
        active: true,
        offboardedAt: true,
        scheduledRedactionAt: true,
        redactedAt: true,
      },
    });
    if (!employee) return fail("NOT_FOUND", "Employee not found", 404);

    // ── Extend ───────────────────────────────────────────────────────
    if (action === "extend") {
      if (employee.redactedAt)
        return fail(
          "ALREADY_REDACTED",
          `${employee.name}'s personal data was already redacted on ${ymd(
            employee.redactedAt,
          )}. There is nothing left to extend retention over.`,
          409,
        );
      if (employee.active || !employee.offboardedAt)
        return fail(
          "NOT_OFFBOARDED",
          "This employee is still active — the retention clock has not started.",
          409,
        );

      // Extend from today, not from an already-past date.
      const newDate = addYears(new Date(), EXTENSION_YEARS);
      await db.$transaction(async (tx) => {
        await tx.employee.update({
          where: { id: employeeId },
          data: { scheduledRedactionAt: newDate },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: "EMPLOYEE_RETENTION_EXTENDED",
            targetEntity: `${employeeId} (${employee.employeeCode}) until ${ymd(
              newDate,
            )} — ${reason}`,
          },
        });
      });

      return NextResponse.json({
        ok: true,
        employeeId,
        scheduledRedactionAt: ymd(newDate),
      });
    }

    // ── Redact ───────────────────────────────────────────────────────
    const eligible = checkEligibility(employee);
    if (!eligible.ok) return fail(eligible.code, eligible.message, 409);

    const patch = redactionPatch();

    await db.$transaction(async (tx) => {
      // ONE update, to ONE row. No cascade, no related table, no delete.
      await tx.employee.update({ where: { id: employeeId }, data: patch });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "EMPLOYEE_DATA_REDACTED",
          // The identifiers are gone, so the audit row records WHICH fields
          // were erased and why — while still naming the employee, because
          // the name is deliberately retained (see lib/employees/retention.ts).
          targetEntity:
            `${employeeId} (${employee.employeeCode} ${employee.name}) ` +
            `fields=[${REDACTED_FIELDS.join(", ")}] ` +
            `offboarded=${employee.offboardedAt ? ymd(employee.offboardedAt) : "unknown"} — ${reason}`,
        },
      });
    });

    return NextResponse.json({
      ok: true,
      employeeId,
      redactedFields: REDACTED_FIELDS,
      redactedAt: ymd(patch.redactedAt),
    });
  } catch (err) {
    console.error("[hr/employee/retention] failed:", err);
    return fail("SERVER_ERROR", "Could not complete the retention action", 503);
  }
}
