import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { withPrivilegedRoute } from "@/lib/mfa-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

/** HR/Super Admin: assign any employee (org-wide) to an active shift. */
async function POSTHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may assign shifts org-wide", 403);

  let body: { employeeId?: unknown; shiftId?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
  const shiftId = typeof body.shiftId === "string" ? body.shiftId : "";
  if (!employeeId || !shiftId)
    return fail("BAD_INPUT", "employeeId and shiftId are required", 400);

  try {
    const shift = await db.shift.findFirst({
      where: { id: shiftId, active: true },
      select: { id: true },
    });
    if (!shift) return fail("BAD_SHIFT", "Shift not found or inactive", 400);

    const result = await db.$transaction(async (tx) => {
      const emp = await tx.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
      if (!emp) return null;
      await tx.employee.update({ where: { id: employeeId }, data: { shiftId } });
      await tx.auditLog.create({
        data: { actorUserId: userId, action: "EMPLOYEE_SHIFT_ASSIGNED", targetEntity: employeeId },
      });
      return emp;
    });
    if (!result) return fail("NOT_FOUND", "Employee not found", 404);

    return NextResponse.json({ ok: true, employeeId, shiftId });
  } catch (err) {
    console.error("[hr/employee/shift] failed:", err);
    return fail("SERVER_ERROR", "Could not assign the shift", 503);
  }
}

// MFA gate — see lib/mfa-guard.ts. Rejects only when the caller's role
// requires two-factor auth and it is not enabled; every other status this
// route returns is produced by the handler above, unchanged.
export const POST = withPrivilegedRoute(POSTHandler);
