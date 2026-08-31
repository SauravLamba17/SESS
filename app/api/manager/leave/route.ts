import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, hasAtLeastRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { notifyEmployee } from "@/lib/notify";
import { fail } from "@/lib/api/response";
import { ymd } from "@/lib/reports/range";
import { onLeaveDecided } from "@/lib/invalidation/leave";

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

  let body: { id?: unknown; decision?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const id = typeof body.id === "string" ? body.id : "";
  const decision = body.decision;
  if (!id || (decision !== "APPROVE" && decision !== "REJECT")) {
    return fail("BAD_INPUT", "id and decision (APPROVE|REJECT) are required", 400);
  }
  const status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
  const action = decision === "APPROVE" ? "LEAVE_APPROVED" : "LEAVE_REJECTED";

  try {
    const manager = await getEmployeeByClerkId(userId);
    if (!manager)
      return fail("NO_EMPLOYEE", "No employee record linked to this account", 403);

    // Atomic: the updateMany where-clause enforces BOTH authorization
    // (employee is this manager's direct report) AND state (still PENDING).
    // Audit only writes when exactly one row transitioned.
    const count = await db.$transaction(async (tx) => {
      const upd = await tx.leaveRequest.updateMany({
        where: {
          id,
          status: "PENDING",
          employee: { managerId: manager.id },
        },
        data: { status, approvedBy: userId },
      });
      if (upd.count === 0) return 0;
      await tx.auditLog.create({
        data: { actorUserId: userId, action, targetEntity: id },
      });

      // Notify the employee, in the same transaction as the decision — the
      // person waiting on this answer is the one who most needs telling.
      const lv = await tx.leaveRequest.findUnique({
        where: { id },
        select: { employeeId: true, startDate: true, endDate: true },
      });
      if (lv) {
        const range =
          lv.startDate.toDateString() === lv.endDate.toDateString()
            ? ymd(lv.startDate)
            : `${ymd(lv.startDate)} to ${ymd(lv.endDate)}`;
        await notifyEmployee(
          tx,
          lv.employeeId,
          decision === "APPROVE" ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
          decision === "APPROVE"
            ? `Your leave request for ${range} was approved.`
            : `Your leave request for ${range} was not approved. Speak to your manager if you need to discuss it.`,
        );
      }
      return upd.count;
    });

    if (count === 0) {
      // Already processed, or not this manager's report — don't assume which.
      return fail(
        "ALREADY_PROCESSED",
        "Request is no longer pending or is not one of your direct reports",
        409,
      );
    }

    // §5 "Employee leave approved → update leave / balance → invalidate
    // employee leave balance, manager approvals and affected dashboard."
    // Fired only on the path where exactly one row actually transitioned —
    // the ALREADY_PROCESSED branch above changed nothing, so it drops nothing.
    onLeaveDecided(manager.id);

    return NextResponse.json({ ok: true, id, status });
  } catch (err) {
    console.error("[manager/leave] failed:", err);
    return fail("SERVER_ERROR", "Could not process the request", 503);
  }
}
