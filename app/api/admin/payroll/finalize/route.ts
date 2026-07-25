import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { isPeriod } from "@/lib/period";
import { periodLabel } from "@/lib/payroll/format";
import { withPrivilegedRoute } from "@/lib/mfa-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

/**
 * SUBMITTED → FINALIZED. The permanent lock, Super Admin only.
 *
 * After this, no code path may alter gross/net/deductions on these rows:
 * app/api/hr/payroll/row/route.ts rejects any non-DRAFT row with a 409, so
 * the immutability is enforced at the API, not merely by hiding the edit UI.
 *
 * Three things happen atomically in ONE transaction, because a payslip that
 * exists without its loan recovery having been applied is a real-money bug:
 *   1. the status transition, counted (rolled back if partial),
 *   2. salary-advance balances reduced by each row's loanDeduction,
 *   3. a PAYSLIP_READY notification per employee.
 */
async function POSTHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only a Super Admin may finalize payroll", 403);

  let body: { period?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const period = typeof body.period === "string" ? body.period.trim() : "";
  if (!isPeriod(period)) return fail("BAD_INPUT", "period must be YYYY-MM", 400);

  try {
    const pending = await db.payroll.findMany({
      where: { month: period, status: "SUBMITTED" },
      select: {
        id: true,
        employeeId: true,
        net: true,
        loanDeduction: true,
        isFinalSettlement: true,
        adjustmentForPayrollId: true,
      },
    });
    if (pending.length === 0)
      return fail(
        "NOT_SUBMITTED",
        `No SUBMITTED payroll rows for ${period} — nothing awaiting finalization.`,
        409,
      );

    const result = await db.$transaction(
      async (tx) => {
        const upd = await tx.payroll.updateMany({
          where: { month: period, status: "SUBMITTED" },
          data: { status: "FINALIZED", finalizedBy: userId, finalizedAt: new Date() },
        });
        if (upd.count !== pending.length) {
          // A row changed state mid-flight. Roll back — a partially finalized
          // run is a worse outcome than a retryable failure.
          throw new Error(`PARTIAL:${upd.count}/${pending.length}`);
        }

        // ── Loan recovery, inside the same transaction ──
        // Only rows that actually recovered something touch a balance. The
        // `remainingBalance: { gte: … }` guard means a concurrent finalize
        // can never drive a balance negative.
        let advancesClosed = 0;
        let advancesReduced = 0;
        const withLoan = pending.filter((p) => p.loanDeduction.greaterThan(0));
        for (const row of withLoan) {
          const advance = await tx.salaryAdvance.findFirst({
            where: { employeeId: row.employeeId, status: "ACTIVE" },
            orderBy: { issuedAt: "asc" },
          });
          if (!advance) continue;

          const reduced = await tx.salaryAdvance.updateMany({
            where: {
              id: advance.id,
              status: "ACTIVE",
              remainingBalance: { gte: row.loanDeduction },
            },
            data: { remainingBalance: { decrement: row.loanDeduction } },
          });
          if (reduced.count === 0) continue;
          advancesReduced += 1;

          const after = advance.remainingBalance.minus(row.loanDeduction);
          if (after.lessThanOrEqualTo(new Prisma.Decimal(0))) {
            await tx.salaryAdvance.update({
              where: { id: advance.id },
              data: { status: "CLOSED" },
            });
            advancesClosed += 1;
          }
        }

        // ── Payslip-ready notifications ──
        await tx.notification.createMany({
          data: pending.map((p) => ({
            employeeId: p.employeeId,
            type: "PAYSLIP_READY",
            message: p.adjustmentForPayrollId
              ? // A correction is the message an employee most needs to read —
                // it says their pay for an already-closed month has changed.
                p.net.isNegative()
                ? `A correction to your ${periodLabel(period)} payslip recovers ₹${p.net.abs().toFixed(2)}. The corrected payslip is available to download.`
                : `A correction to your ${periodLabel(period)} payslip pays an additional ₹${p.net.toFixed(2)}. The corrected payslip is available to download.`
              : p.isFinalSettlement
                ? `Your full & final settlement for ${periodLabel(period)} is ready to download.`
                : `Your payslip for ${periodLabel(period)} is ready to download.`,
          })),
        });

        await tx.auditLog.create({
          data: { actorUserId: userId, action: "PAYROLL_RUN_FINALIZED", targetEntity: period },
        });

        return { finalized: upd.count, advancesReduced, advancesClosed };
      },
      { timeout: 30_000 },
    );

    return NextResponse.json({ ok: true, period, ...result });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("PARTIAL:")) {
      console.error("[admin/payroll/finalize] partial transition, rolled back:", err.message);
      return fail(
        "CONCURRENT_CHANGE",
        "The run changed while finalizing and was rolled back — nothing was finalized. Reload and try again.",
        409,
      );
    }
    console.error("[admin/payroll/finalize] failed:", err);
    return fail("SERVER_ERROR", "Could not finalize the payroll run", 503);
  }
}

// MFA gate — see lib/mfa-guard.ts. Rejects only when the caller's role
// requires two-factor auth and it is not enabled; every other status this
// route returns is produced by the handler above, unchanged.
export const POST = withPrivilegedRoute(POSTHandler);
