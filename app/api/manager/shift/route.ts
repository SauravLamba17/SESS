import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, hasAtLeastRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { fail } from "@/lib/api/response";
import { onEmployeeShiftAssigned } from "@/lib/invalidation/employee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Manager: reassign a DIRECT REPORT's shift only. Auth check is folded into
 * the same transaction as the write (same pattern as target/quality/feedback). */
export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);

  // ROLE gate, IN ADDITION TO the direct-report scope check further down —
  // not instead of it. Org-chart position and role are decoupled in this
  // schema: an Employee.managerId can point at someone whose Clerk role is
  // still EMPLOYEE (a shift lead onboarded without a role bump). middleware.ts
  // deliberately does not gate /api/**, so without this an EMPLOYEE-role user
  // in a manager position could drive their reports' records through the API
  // even though the UI never offers them the page.
  if (!(await hasAtLeastRole("MANAGER")))
    return fail("FORBIDDEN", "Only a Manager or above may use this endpoint", 403);

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
    const manager = await getEmployeeByClerkId(userId);
    if (!manager)
      return fail("NO_EMPLOYEE", "No employee record linked to this account", 403);

    const shift = await db.shift.findFirst({
      where: { id: shiftId, active: true },
      select: { id: true },
    });
    if (!shift) return fail("BAD_SHIFT", "Shift not found or inactive", 400);

    // Authorization + write in one transaction: the update only lands if the
    // target is this manager's active direct report.
    const result = await db.$transaction(async (tx) => {
      const report = await tx.employee.findFirst({
        where: { id: employeeId, managerId: manager.id, active: true },
        select: { id: true },
      });
      if (!report) return null;
      await tx.employee.update({ where: { id: employeeId }, data: { shiftId } });
      await tx.auditLog.create({
        data: { actorUserId: userId, action: "EMPLOYEE_SHIFT_ASSIGNED", targetEntity: employeeId },
      });
      return report;
    });
    if (!result)
      return fail("NOT_DIRECT_REPORT", "That employee is not your direct report", 403);

    // §5: this manager's own roster shows the shift that just changed.
    onEmployeeShiftAssigned({ employeeId, managerEmployeeId: manager.id });

    return NextResponse.json({ ok: true, employeeId, shiftId });
  } catch (err) {
    console.error("[manager/shift] failed:", err);
    return fail("SERVER_ERROR", "Could not assign the shift", 503);
  }
}
