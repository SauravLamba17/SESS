import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseDateOnly } from "@/lib/period";
import { withPrivilegedRoute } from "@/lib/mfa-guard";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseMoney(v: unknown): Prisma.Decimal | null {
  const s = typeof v === "number" ? String(v) : str(v);
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  try {
    return new Prisma.Decimal(s);
  } catch {
    return null;
  }
}

/**
 * Create or edit an offer (DRAFT only).
 *
 * Salary figures are Decimal end to end, same as Payroll — these become the
 * new hire's SalaryStructure verbatim on acceptance, so a float here would
 * put a rounding error into someone's actual pay.
 *
 * Editing is permitted ONLY while DRAFT. Once a Super Admin has approved or HR
 * has sent the offer, the figures are locked — enforced here with a status
 * guard in the where-clause, exactly as Payroll protects a FINALIZED row.
 */
async function POSTHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may create offers", 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const applicationId = str(body.applicationId);
  const proposedBasic = parseMoney(body.proposedBasic);
  const proposedHra = parseMoney(body.proposedHra);
  const proposedSpecialAllowance = parseMoney(body.proposedSpecialAllowance);
  const proposedDesignation = str(body.proposedDesignation);
  const proposedDepartment = str(body.proposedDepartment);
  const proposedManagerId = str(body.proposedManagerId) || null;
  const joiningDateStr = str(body.joiningDate);

  if (!applicationId) return fail("BAD_INPUT", "applicationId is required", 400);
  if (!proposedBasic || !proposedHra || !proposedSpecialAllowance)
    return fail(
      "BAD_INPUT",
      "proposedBasic, proposedHra and proposedSpecialAllowance must be non-negative amounts",
      400,
    );
  if (proposedBasic.lessThanOrEqualTo(0))
    return fail("BAD_INPUT", "Basic must be greater than zero", 400);
  if (!proposedDesignation || !proposedDepartment)
    return fail("BAD_INPUT", "proposedDesignation and proposedDepartment are required", 400);
  const joiningDate = parseDateOnly(joiningDateStr);
  if (!joiningDate)
    return fail("BAD_INPUT", "joiningDate must be a valid YYYY-MM-DD date", 400);

  try {
    const application = await db.application.findUnique({
      where: { id: applicationId },
      select: { id: true, stage: true, offer: { select: { id: true, status: true } } },
    });
    if (!application) return fail("NOT_FOUND", "Application not found", 404);

    // An offer is only meaningful once the candidate has reached OFFER stage.
    if (application.stage !== "OFFER")
      return fail(
        "WRONG_STAGE",
        `Move the candidate to the OFFER stage first — they are currently at ${application.stage}.`,
        409,
      );

    if (proposedManagerId) {
      const mgr = await db.employee.findFirst({
        where: { id: proposedManagerId, active: true },
        select: { id: true },
      });
      if (!mgr)
        return fail("BAD_MANAGER", "Selected reporting manager is not an active employee", 400);
    }

    const fields = {
      proposedBasic,
      proposedHra,
      proposedSpecialAllowance,
      proposedDesignation,
      proposedDepartment,
      proposedManagerId,
      joiningDate,
    };

    // ── Edit an existing DRAFT ──
    if (application.offer) {
      if (application.offer.status !== "DRAFT")
        return fail(
          "LOCKED",
          application.offer.status === "SENT"
            ? "This offer has been SENT and its figures are permanently immutable. Withdraw it and raise a new offer if terms must change."
            : `This offer is ${application.offer.status} and can no longer be edited.`,
          409,
        );

      // Atomic: status guard means a concurrent approve/send cannot be
      // overwritten between the read above and this write.
      const upd = await db.offer.updateMany({
        where: { id: application.offer.id, status: "DRAFT" },
        data: fields,
      });
      if (upd.count === 0)
        return fail(
          "LOCKED",
          "This offer changed state while you were editing it and is no longer a draft.",
          409,
        );
      return NextResponse.json({ ok: true, id: application.offer.id, status: "DRAFT" });
    }

    // ── Create ──
    const created = await db.$transaction(async (tx) => {
      const offer = await tx.offer.create({
        data: { applicationId, createdBy: userId, ...fields },
      });
      await tx.auditLog.create({
        data: { actorUserId: userId, action: "OFFER_CREATED", targetEntity: offer.id },
      });
      return offer;
    });

    return NextResponse.json({ ok: true, id: created.id, status: created.status });
  } catch (err) {
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002")
      return fail("OFFER_EXISTS", "An offer already exists for this application.", 409);
    console.error("[hr/offer] failed:", err);
    return fail("SERVER_ERROR", "Could not save the offer", 503);
  }
}

// MFA gate — see lib/mfa-guard.ts. Rejects only when the caller's role
// requires two-factor auth and it is not enabled; every other status this
// route returns is produced by the handler above, unchanged.
export const POST = withPrivilegedRoute(POSTHandler);
