import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { withPrivilegedRoute } from "@/lib/mfa-guard";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deactivate (soft) or reactivate a shift. There is deliberately NO hard-delete
 * endpoint for shifts — deleting one would orphan every Employee.shiftId that
 * points at it. Deactivating keeps the row (and existing assignments) intact;
 * it just drops the shift out of the assignable dropdowns.
 */
async function POSTHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may manage shifts", 403);

  let body: { id?: unknown; active?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const id = typeof body.id === "string" ? body.id : "";
  const active = body.active === true; // default: deactivate
  if (!id) return fail("BAD_INPUT", "id is required", 400);

  try {
    const shift = await db.shift.findUnique({
      where: { id },
      include: { _count: { select: { employees: true } } },
    });
    if (!shift) return fail("NOT_FOUND", "Shift not found", 404);

    await db.shift.update({ where: { id }, data: { active } });
    return NextResponse.json({
      ok: true,
      id,
      active,
      assignedEmployees: shift._count.employees,
    });
  } catch (err) {
    console.error("[hr/shifts/deactivate] failed:", err);
    return fail("SERVER_ERROR", "Could not update the shift", 503);
  }
}

// MFA gate — see lib/mfa-guard.ts. Rejects only when the caller's role
// requires two-factor auth and it is not enabled; every other status this
// route returns is produced by the handler above, unchanged.
export const POST = withPrivilegedRoute(POSTHandler);
