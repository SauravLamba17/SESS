import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { fail } from "@/lib/api/response";
import { onRecruitmentChanged } from "@/lib/invalidation/employee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Create / edit / close a job requisition.
 *
 * `action` dispatch keeps one route for one resource. Closing is a distinct
 * action rather than a status field on the edit path, because closing has a
 * side effect (closedAt) and its own audit entry.
 */
export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may manage requisitions", 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const action = str(body.action) || "create";

  try {
    // ── Close ────────────────────────────────────────────────────────
    if (action === "close") {
      const id = str(body.id);
      if (!id) return fail("BAD_INPUT", "id is required", 400);

      // Atomic: status in the where-clause, so a double-click cannot
      // re-close and overwrite the original closedAt.
      const count = await db.$transaction(async (tx) => {
        const upd = await tx.jobRequisition.updateMany({
          where: { id, status: { in: ["OPEN", "ON_HOLD"] } },
          data: { status: "CLOSED", closedAt: new Date() },
        });
        if (upd.count === 0) return 0;
        await tx.auditLog.create({
          data: { actorUserId: userId, action: "REQUISITION_CLOSED", targetEntity: id },
        });
        return upd.count;
      });
      if (count === 0)
        return fail("ALREADY_CLOSED", "This requisition is already closed.", 409);
      // §2 recruitment dashboard + the PUBLIC /careers listing both change the
      // moment a role closes — and the public one is the reason this cannot
      // wait out its 5-minute TTL. Fired only when a row actually transitioned.
      onRecruitmentChanged();
      return NextResponse.json({ ok: true, id, status: "CLOSED" });
    }

    // ── Reopen / hold ────────────────────────────────────────────────
    if (action === "status") {
      const id = str(body.id);
      const status = str(body.status);
      if (!id || (status !== "OPEN" && status !== "ON_HOLD"))
        return fail("BAD_INPUT", "id and status (OPEN|ON_HOLD) are required", 400);

      const upd = await db.jobRequisition.updateMany({
        where: { id },
        data: { status, closedAt: null },
      });
      if (upd.count === 0) return fail("NOT_FOUND", "Requisition not found", 404);
      onRecruitmentChanged();
      return NextResponse.json({ ok: true, id, status });
    }

    // ── Create / edit ────────────────────────────────────────────────
    const title = str(body.title);
    const department = str(body.department);
    const description = str(body.description);
    const openingsRaw = body.openings;
    const openings =
      typeof openingsRaw === "number"
        ? Math.trunc(openingsRaw)
        : Number.parseInt(str(openingsRaw), 10);

    if (!title || !department || !description)
      return fail("BAD_INPUT", "title, department and description are required", 400);
    if (!Number.isFinite(openings) || openings < 1)
      return fail("BAD_INPUT", "openings must be a whole number of at least 1", 400);

    const id = str(body.id);
    if (id) {
      // Editing a CLOSED requisition would silently resurrect it for
      // applicants — reopen it explicitly instead.
      const existing = await db.jobRequisition.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!existing) return fail("NOT_FOUND", "Requisition not found", 404);
      if (existing.status === "CLOSED")
        return fail(
          "CLOSED",
          "This requisition is closed. Reopen it before editing.",
          409,
        );

      await db.jobRequisition.update({
        where: { id },
        data: { title, department, description, openings },
      });
      onRecruitmentChanged();
      return NextResponse.json({ ok: true, id });
    }

    const created = await db.$transaction(async (tx) => {
      const r = await tx.jobRequisition.create({
        data: { title, department, description, openings, createdBy: userId },
      });
      await tx.auditLog.create({
        data: { actorUserId: userId, action: "REQUISITION_CREATED", targetEntity: r.id },
      });
      return r;
    });

    onRecruitmentChanged();
    return NextResponse.json({ ok: true, id: created.id });
  } catch (err) {
    console.error("[hr/requisition] failed:", err);
    return fail("SERVER_ERROR", "Could not save the requisition", 503);
  }
}
