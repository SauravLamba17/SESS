import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, hasAtLeastRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { currentPeriod } from "@/lib/period";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  let body: { employeeId?: unknown; targetUnits?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
  const targetUnits = Number(body.targetUnits);
  if (!employeeId || !Number.isInteger(targetUnits) || targetUnits < 0) {
    return fail(
      "BAD_INPUT",
      "employeeId and a non-negative integer targetUnits are required",
      400,
    );
  }

  const { period } = currentPeriod();

  try {
    const manager = await getEmployeeByClerkId(userId);
    if (!manager)
      return fail("NO_EMPLOYEE", "No employee record linked to this account", 403);

    // Authorization + write in one transaction. Upsert's unique selector
    // (employeeId+period) can't also carry managerId, so the direct-report
    // check lives in the same tx as the upsert + audit.
    const result = await db.$transaction(async (tx) => {
      const report = await tx.employee.findFirst({
        where: { id: employeeId, managerId: manager.id, active: true },
        select: { id: true },
      });
      if (!report) return null;

      const target = await tx.monthlyTarget.upsert({
        where: { employeeId_period: { employeeId, period } },
        create: { employeeId, period, targetUnits, setBy: userId },
        update: { targetUnits, setBy: userId },
      });
      await tx.auditLog.create({
        data: { actorUserId: userId, action: "TARGET_SET", targetEntity: target.id },
      });
      return target;
    });

    if (!result)
      return fail("NOT_DIRECT_REPORT", "That employee is not your direct report", 403);

    return NextResponse.json({
      ok: true,
      employeeId,
      period,
      targetUnits: result.targetUnits,
    });
  } catch (err) {
    console.error("[manager/target] failed:", err);
    return fail("SERVER_ERROR", "Could not set the target", 503);
  }
}
