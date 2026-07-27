import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeGrossNet } from "@/lib/payroll/compute";
import { parseMoney } from "@/lib/payroll/money";
import { withPrivilegedRoute } from "@/lib/mfa-guard";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The SIGNED money parser — deliberately local to this file.
 *
 * An adjustment row carries DELTAS against an already-finalized payroll run, so
 * a negative amount is meaningful there and nowhere else. The unsigned parser
 * every other money route uses lives in lib/payroll/money.ts and stays
 * unsigned; this one is not exported, so the ability to accept a negative
 * cannot spread to a salary structure, an advance, or a normal payroll row.
 *
 * Callers below pass `signed` only when the row being edited is genuinely an
 * adjustment (`row.adjustmentForPayrollId !== null`).
 */
function parseSignedMoney(v: unknown, signed: boolean): Prisma.Decimal | null {
  if (!signed) return parseMoney(v);
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  try {
    return new Prisma.Decimal(s);
  } catch {
    return null;
  }
}

const MONEY_FIELDS = [
  "pfEmployee",
  "pfEmployer",
  "esi",
  "professionalTax",
  "tds",
  "bonus",
] as const;

/**
 * Earnings are editable ONLY on an adjustment row. On a regular row they are
 * snapshotted from the salary structure and pro-rated at run creation —
 * letting HR retype them there would break the link between the stored
 * daysWorked/daysInMonth and the figures they supposedly produced.
 */
const ADJUSTMENT_EARNING_FIELDS = ["basic", "hra", "specialAllowance"] as const;

/**
 * Edit the HR-entered figures on a DRAFT payroll row, recomputing gross/net.
 *
 * `tds` is stored exactly as HR typed it. It is a figure from the company's
 * CA — this route does not derive, validate against a slab, or adjust it.
 *
 * On an adjustment row every figure is a DELTA against the original (see
 * app/api/hr/payroll/adjustment/route.ts for why), so signed amounts are
 * accepted and the three earning components become editable.
 */
async function POSTHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may edit payroll rows", 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return fail("BAD_INPUT", "id is required", 400);

  try {
    const row = await db.payroll.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        basic: true,
        hra: true,
        specialAllowance: true,
        reimbursements: true,
        loanDeduction: true,
        adjustmentForPayrollId: true,
      },
    });
    if (!row) return fail("NOT_FOUND", "Payroll row not found", 404);

    // Explicit, before the atomic guard, so the caller gets a message that
    // names the actual state rather than a generic conflict.
    if (row.status !== "DRAFT") {
      return fail(
        "LOCKED",
        row.status === "FINALIZED"
          ? "This payroll row is FINALIZED and permanently immutable. Corrections must be issued as a separate adjustment record."
          : "This payroll row is SUBMITTED and locked for HR editing while it awaits Super Admin finalization.",
        409,
      );
    }

    // Whether signed amounts and editable earnings are allowed depends on the
    // row type, so parsing happens after the row is known.
    const isAdjustment = row.adjustmentForPayrollId !== null;

    const values: Record<string, Prisma.Decimal> = {};
    for (const f of MONEY_FIELDS) {
      const parsed = parseSignedMoney(body[f], isAdjustment);
      if (!parsed)
        return fail(
          "BAD_INPUT",
          isAdjustment
            ? `${f} must be an amount with at most 2 decimals (negative allowed on an adjustment)`
            : `${f} must be a non-negative amount with at most 2 decimals`,
          400,
        );
      values[f] = parsed;
    }

    // Earnings: editable deltas on an adjustment, untouched snapshot otherwise.
    const earnings = {
      basic: row.basic,
      hra: row.hra,
      specialAllowance: row.specialAllowance,
    };
    if (isAdjustment) {
      for (const f of ADJUSTMENT_EARNING_FIELDS) {
        const parsed = parseSignedMoney(body[f], true);
        if (!parsed)
          return fail(
            "BAD_INPUT",
            `${f} must be an amount with at most 2 decimals (negative allowed on an adjustment)`,
            400,
          );
        earnings[f] = parsed;
      }
    }

    const tdsSource = typeof body.tdsSource === "string" ? body.tdsSource.trim() : "";
    // A TDS figure with no stated provenance is not auditable, so require the
    // source whenever TDS is non-zero. On an adjustment a NEGATIVE tds is a
    // refund of over-deducted tax and needs provenance just as much.
    if (!values.tds.isZero() && !tdsSource)
      return fail(
        "BAD_INPUT",
        "tdsSource is required when TDS is non-zero — record where the figure came from (e.g. \"CA-provided, FY2026-27\")",
        400,
      );

    const { gross, deductions, net } = computeGrossNet({
      basic: earnings.basic,
      hra: earnings.hra,
      specialAllowance: earnings.specialAllowance,
      pfEmployee: values.pfEmployee,
      esi: values.esi,
      professionalTax: values.professionalTax,
      tds: values.tds,
      // Loan recovery is NOT HR-editable: the amount is derived from the
      // advance's remaining balance, and the finalize step reduces that
      // balance by exactly this figure. Letting HR retype it here would let
      // the payslip and the loan ledger disagree.
      loanDeduction: row.loanDeduction,
      bonus: values.bonus,
      reimbursements: row.reimbursements,
    });

    // Atomic: `status: "DRAFT"` in the where-clause means a concurrent submit
    // or finalize between the read above and this write cannot be overwritten.
    const count = await db.$transaction(async (tx) => {
      const upd = await tx.payroll.updateMany({
        where: { id, status: "DRAFT" },
        data: {
          ...values,
          // Only written back on an adjustment; on a regular row these are the
          // same values that were just read, so the write is a no-op.
          ...(isAdjustment ? earnings : {}),
          tdsSource,
          gross,
          deductions,
          net,
          processedBy: userId,
        },
      });
      if (upd.count === 0) return 0;
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: isAdjustment ? "PAYROLL_ADJUSTMENT_UPDATED" : "PAYROLL_ROW_UPDATED",
          targetEntity: id,
        },
      });
      return upd.count;
    });

    if (count === 0)
      return fail(
        "LOCKED",
        "This payroll row changed state while you were editing it and is no longer a draft.",
        409,
      );

    return NextResponse.json({
      ok: true,
      id,
      gross: gross.toFixed(2),
      deductions: deductions.toFixed(2),
      net: net.toFixed(2),
    });
  } catch (err) {
    console.error("[hr/payroll/row] failed:", err);
    return fail("SERVER_ERROR", "Could not update the payroll row", 503);
  }
}

// MFA gate — see lib/mfa-guard.ts. Rejects only when the caller's role
// requires two-factor auth and it is not enabled; every other status this
// route returns is produced by the handler above, unchanged.
export const POST = withPrivilegedRoute(POSTHandler);
