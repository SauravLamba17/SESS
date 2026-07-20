import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

/**
 * DRAFT → APPROVED. Super Admin only.
 *
 * Same shape as the Payroll finalize lock: the transition is guarded by the
 * current status inside the where-clause and the affected count is verified,
 * so a concurrent second approval cannot double-apply and a partial result is
 * impossible rather than merely unlikely.
 */
export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only a Super Admin may approve offers", 403);

  let body: { id?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return fail("BAD_INPUT", "id is required", 400);

  try {
    const offer = await db.offer.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!offer) return fail("NOT_FOUND", "Offer not found", 404);
    if (offer.status !== "DRAFT")
      return fail(
        "NOT_DRAFT",
        `Only a DRAFT offer can be approved — this one is ${offer.status}.`,
        409,
      );

    const count = await db.$transaction(async (tx) => {
      const upd = await tx.offer.updateMany({
        where: { id, status: "DRAFT" },
        data: { status: "APPROVED", approvedBy: userId, approvedAt: new Date() },
      });
      if (upd.count !== 1) return upd.count;
      await tx.auditLog.create({
        data: { actorUserId: userId, action: "OFFER_APPROVED", targetEntity: id },
      });
      return upd.count;
    });

    if (count === 0)
      return fail(
        "CONCURRENT_CHANGE",
        "This offer changed state before it could be approved. Reload and try again.",
        409,
      );

    return NextResponse.json({ ok: true, id, status: "APPROVED" });
  } catch (err) {
    console.error("[admin/offer/approve] failed:", err);
    return fail("SERVER_ERROR", "Could not approve the offer", 503);
  }
}
