import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { withPrivilegedRoute } from "@/lib/mfa-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

async function POSTHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may manage shifts", 403);

  let body: {
    id?: unknown;
    name?: unknown;
    startTime?: unknown;
    endTime?: unknown;
    gracePeriodMinutes?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const id = typeof body.id === "string" && body.id ? body.id : null;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const startTime = typeof body.startTime === "string" ? body.startTime.trim() : "";
  const endTime = typeof body.endTime === "string" ? body.endTime.trim() : "";
  const grace = Number(body.gracePeriodMinutes);

  if (!name) return fail("BAD_INPUT", "name is required", 400);
  if (!HHMM.test(startTime) || !HHMM.test(endTime))
    return fail("BAD_INPUT", "startTime and endTime must be HH:MM (24h)", 400);
  if (!Number.isInteger(grace) || grace < 0)
    return fail("BAD_INPUT", "gracePeriodMinutes must be an integer ≥ 0", 400);

  try {
    // Name uniqueness (server-side): reject if the name belongs to another shift.
    const clash = await db.shift.findUnique({ where: { name } });
    if (clash && clash.id !== id)
      return fail("DUPLICATE_NAME", `A shift named "${name}" already exists`, 409);

    const data = { name, startTime, endTime, gracePeriodMinutes: grace };
    const action = id ? "SHIFT_UPDATED" : "SHIFT_CREATED";

    const shift = await db.$transaction(async (tx) => {
      if (id) {
        const exists = await tx.shift.findUnique({ where: { id }, select: { id: true } });
        if (!exists) return null;
        const updated = await tx.shift.update({ where: { id }, data });
        await tx.auditLog.create({
          data: { actorUserId: userId, action, targetEntity: updated.id },
        });
        return updated;
      }
      const created = await tx.shift.create({ data: { ...data, createdBy: userId } });
      await tx.auditLog.create({
        data: { actorUserId: userId, action, targetEntity: created.id },
      });
      return created;
    });

    if (!shift) return fail("NOT_FOUND", "Shift not found", 404);
    return NextResponse.json({ ok: true, id: shift.id, name: shift.name });
  } catch (err) {
    console.error("[hr/shifts] failed:", err);
    return fail("SERVER_ERROR", "Could not save the shift", 503);
  }
}

// MFA gate — see lib/mfa-guard.ts. Rejects only when the caller's role
// requires two-factor auth and it is not enabled; every other status this
// route returns is produced by the handler above, unchanged.
export const POST = withPrivilegedRoute(POSTHandler);
