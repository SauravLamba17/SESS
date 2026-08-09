import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseDateOnly } from "@/lib/period";
import { getCurrentRole } from "@/lib/auth";
import { assemblePayrollRow } from "@/lib/payroll/assemble";
import { scheduledRedactionFor, RETENTION_YEARS, ymd } from "@/lib/employees/retention";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The $transaction below is capped at 30s. Bound the function just above that
// so Prisma's own timeout wins the race and returns a real error, rather than
// Vercel killing the invocation mid-transaction and returning a bare 504.
// Set explicitly rather than inheriting the platform default, so the ceiling
// stays tied to the transaction's own timeout if that default ever changes.
export const maxDuration = 45;

/** "YYYY-MM" period a date falls in. */
function periodOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Exclusive upper bound of a "YYYY-MM" period. */
function monthEnd(period: string): Date {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m, 1);
}

/**
 * Offboard an employee (Phase 5) and raise their Full & Final settlement
 * (Phase 7) in ONE transaction.
 *
 * The settlement is NOT a parallel flow — it is part of the same offboarding
 * event, sharing its transaction and its audit trail, so an employee can never
 * end up inactive without a settlement raised, or vice versa.
 *
 * The settlement row is created as DRAFT and follows the identical
 * DRAFT→SUBMITTED→FINALIZED workflow as a normal run. It is deliberately NOT
 * auto-finalized: a settlement is exactly the payroll a departing employee is
 * most likely to dispute, so it gets the same HR review and Super Admin lock.
 */
export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may offboard employees", 403);

  let body: { employeeId?: unknown; lastWorkingDay?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
  if (!employeeId) return fail("BAD_INPUT", "employeeId is required", 400);

  // Last working day drives the settlement's pro-ration. Defaults to today.
  let lastWorkingDay: Date;
  if (typeof body.lastWorkingDay === "string" && body.lastWorkingDay.trim()) {
    const parsed = parseDateOnly(body.lastWorkingDay);
    if (!parsed) return fail("BAD_INPUT", "lastWorkingDay must be YYYY-MM-DD", 400);
    lastWorkingDay = parsed;
  } else {
    const n = new Date();
    lastWorkingDay = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  try {
    const result = await db.$transaction(
      async (tx) => {
        const emp = await tx.employee.findUnique({
          where: { id: employeeId },
          select: {
            id: true,
            active: true,
            joiningDate: true,
            salaryStructure: {
              select: { basic: true, hra: true, specialAllowance: true },
            },
          },
        });
        if (!emp) return { code: "NOT_FOUND" as const };
        if (!emp.active) return { code: "ALREADY_INACTIVE" as const };

        // Phase 5 rule, unchanged: don't orphan active direct reports.
        const activeReports = await tx.employee.count({
          where: { managerId: employeeId, active: true },
        });
        if (activeReports > 0) return { code: "HAS_REPORTS" as const, activeReports };

        if (lastWorkingDay < emp.joiningDate)
          return { code: "BEFORE_JOINING" as const };

        // ── Phase 5: the soft-delete itself, plus the exit date ──
        // Phase 13 adds the retention clock to this SAME update rather than a
        // second offboarding path: an employee can never become inactive
        // without their redaction date being set at the same instant.
        //
        // NOTE: this does NOT delete the User row or revoke the Clerk account.
        // Offboarded employees intentionally retain login access so they can
        // view/download their own historical payslips and data after leaving —
        // this is a deliberate design decision, not an oversight. See
        // lib/employees/invite.ts and app/employee/profile/actions.ts for the
        // corresponding write-protection guards that still apply to them.
        await tx.employee.update({
          where: { id: employeeId },
          data: {
            active: false,
            offboardedAt: lastWorkingDay,
            scheduledRedactionAt: scheduledRedactionFor(lastWorkingDay),
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: "EMPLOYEE_OFFBOARDED",
            targetEntity:
              `${employeeId} lastWorkingDay=${ymd(lastWorkingDay)} ` +
              `redactionDue=${ymd(scheduledRedactionFor(lastWorkingDay))} (+${RETENTION_YEARS}y)`,
          },
        });

        // ── Phase 7: the Full & Final settlement ──
        // No salary structure means we cannot compute a settlement. Offboarding
        // still completes — reported, not silently skipped.
        if (!emp.salaryStructure) {
          return { code: "OK_NO_STRUCTURE" as const };
        }

        const period = periodOf(lastWorkingDay);

        // A settlement must not double-pay a claim already folded into a
        // regular run, so the same includedInPayrollId guard applies.
        const claims = await tx.expenseClaim.findMany({
          where: {
            employeeId,
            status: "APPROVED",
            includedInPayrollId: null,
            date: { lt: monthEnd(period) },
          },
          select: { id: true, amount: true },
        });

        const advance = await tx.salaryAdvance.findFirst({
          where: { employeeId, status: "ACTIVE" },
          select: { id: true, monthlyDeduction: true, remainingBalance: true },
          orderBy: { issuedAt: "asc" },
        });

        // Same shared assembler the monthly run uses — settlement: true is the
        // only difference, recovering the FULL outstanding balance rather than
        // one installment.
        const row = assemblePayrollRow({
          period,
          structure: emp.salaryStructure,
          joiningDate: emp.joiningDate,
          offboardedAt: lastWorkingDay,
          claims,
          advance,
          settlement: true,
        });

        const settlement = await tx.payroll.create({
          data: {
            employeeId,
            month: period,
            isFinalSettlement: true,
            basic: row.basic,
            hra: row.hra,
            specialAllowance: row.specialAllowance,
            daysWorked: row.daysWorked,
            daysInMonth: row.daysInMonth,
            reimbursements: row.reimbursements,
            loanDeduction: row.loanDeduction,
            gross: row.gross,
            deductions: row.deductions,
            net: row.net,
            processedBy: userId,
          },
        });

        if (row.claimIds.length > 0) {
          await tx.expenseClaim.updateMany({
            where: { id: { in: row.claimIds }, includedInPayrollId: null },
            data: { includedInPayrollId: settlement.id },
          });
        }

        // NOTE: the advance's balance is NOT reduced here. Recovery happens at
        // FINALIZE (app/api/admin/payroll/finalize), same as every other row.
        // Closing the loan at offboard would mark it settled against a DRAFT
        // settlement that a Super Admin has not approved and that HR may still
        // revise — the ledger would then disagree with the payslip.
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: "FULL_FINAL_SETTLEMENT_CREATED",
            targetEntity: settlement.id,
          },
        });

        return {
          code: "OK" as const,
          settlementId: settlement.id,
          period,
          daysWorked: row.daysWorked,
          daysInMonth: row.daysInMonth,
          net: row.net.toFixed(2),
          loanDeduction: row.loanDeduction.toFixed(2),
          reimbursements: row.reimbursements.toFixed(2),
          claimsIncluded: row.claimIds.length,
        };
      },
      { timeout: 30_000 },
    );

    switch (result.code) {
      case "NOT_FOUND":
        return fail("NOT_FOUND", "Employee not found", 404);
      case "ALREADY_INACTIVE":
        return fail("ALREADY_INACTIVE", "Employee is already offboarded", 409);
      case "BEFORE_JOINING":
        return fail(
          "BAD_INPUT",
          "Last working day cannot be before the employee's joining date",
          400,
        );
      case "HAS_REPORTS":
        return fail(
          "HAS_ACTIVE_REPORTS",
          `Cannot offboard: this employee still manages ${result.activeReports} active direct report(s). Reassign them to another manager first.`,
          409,
        );
      case "OK_NO_STRUCTURE":
        return NextResponse.json({
          ok: true,
          employeeId,
          settlement: null,
          warning:
            "Employee offboarded, but no full & final settlement was raised — they have no salary structure set.",
        });
      default:
        return NextResponse.json({ ok: true, employeeId, settlement: result });
    }
  } catch (err) {
    console.error("[hr/employee offboard] failed:", err);
    return fail("SERVER_ERROR", "Could not offboard the employee", 503);
  }
}
