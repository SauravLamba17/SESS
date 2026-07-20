import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

/**
 * Create a DRAFT adjustment row correcting a FINALIZED payroll row.
 *
 * DELTA SEMANTICS — this row carries the DIFFERENCE, not the corrected total.
 * Two reasons, and the first is decisive:
 *
 *  1. Form 16 (app/api/form16) sums `gross` and `tds` across every FINALIZED
 *     row in a financial year. Deltas sum to the right answer automatically.
 *     Corrected-totals would double-count the original and produce a legally
 *     wrong tax document.
 *  2. `net` means "what is paid out by this row" on every other Payroll row in
 *     the system. Deltas keep that meaning uniform; corrected-totals would
 *     silently change what `net` means depending on the row type.
 *
 * A negative adjustment is therefore legitimate — that is how an overpayment
 * is recovered — and the edit route accepts signed amounts on these rows only.
 *
 * All money fields start at ZERO. Nothing is copied from the original: an
 * adjustment of "no change" must be 0.00, not a duplicate of the original's
 * figures that HR has to zero out by hand.
 */
export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may create a payroll adjustment", 403);

  let body: { payrollId?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const payrollId = typeof body.payrollId === "string" ? body.payrollId : "";
  if (!payrollId) return fail("BAD_INPUT", "payrollId is required", 400);

  try {
    const original = await db.payroll.findUnique({
      where: { id: payrollId },
      select: {
        id: true,
        employeeId: true,
        month: true,
        status: true,
        isFinalSettlement: true,
        daysWorked: true,
        daysInMonth: true,
        adjustmentForPayrollId: true,
        employee: { select: { name: true } },
      },
    });
    if (!original) return fail("NOT_FOUND", "Payroll row not found", 404);

    // THE RULE (identical to the original's own lock): only a FINALIZED row
    // can be adjusted. This is what stops an unbounded chain of drafts — a
    // fresh adjustment is DRAFT, so it cannot itself be adjusted until it has
    // been submitted and finalized in its own right. Correcting a correction
    // is legitimate, but only once the correction is real.
    if (original.status !== "FINALIZED")
      return fail(
        "NOT_FINALIZED",
        original.adjustmentForPayrollId
          ? `This adjustment is still ${original.status}. Finalize it before correcting it again — a draft correction cannot itself be corrected.`
          : `Only a FINALIZED payroll row can be adjusted. This row is ${original.status}; edit it directly instead.`,
        409,
      );

    // One open correction at a time per original. Without this, HR could stack
    // several pending adjustments against the same row and no one could tell
    // which of them the finalized total was supposed to reflect.
    const openAdjustment = await db.payroll.findFirst({
      where: {
        adjustmentForPayrollId: original.id,
        status: { in: ["DRAFT", "SUBMITTED"] },
      },
      select: { id: true, status: true },
    });
    if (openAdjustment)
      return fail(
        "ADJUSTMENT_OPEN",
        `An adjustment for this row already exists and is ${openAdjustment.status}. Finalize or resolve it before creating another.`,
        409,
      );

    const adjustment = await db.$transaction(async (tx) => {
      const created = await tx.payroll.create({
        data: {
          employeeId: original.employeeId,
          month: original.month,
          adjustmentForPayrollId: original.id,
          // A correction to a final settlement is itself part of that
          // settlement, so the flag carries over.
          isFinalSettlement: original.isFinalSettlement,
          // Copied for traceability only — an adjustment pays a delta, not a
          // number of days. The payslip suppresses the days line on these rows.
          daysWorked: original.daysWorked,
          daysInMonth: original.daysInMonth,
          // Every money field intentionally left at its 0 default.
          processedBy: userId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "PAYROLL_ADJUSTMENT_CREATED",
          // Both ids, so the trail reads in either direction.
          targetEntity: `${created.id} adjusts ${original.id}`,
        },
      });

      return created;
    });

    return NextResponse.json({
      ok: true,
      id: adjustment.id,
      adjustmentForPayrollId: original.id,
      month: original.month,
      employeeName: original.employee.name,
    });
  } catch (err) {
    console.error("[hr/payroll/adjustment] failed:", err);
    return fail("SERVER_ERROR", "Could not create the adjustment", 503);
  }
}
