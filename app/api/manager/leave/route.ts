import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { notifyEmployee } from "@/lib/notify";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);

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
            ? lv.startDate.toISOString().slice(0, 10)
            : `${lv.startDate.toISOString().slice(0, 10)} to ${lv.endDate.toISOString().slice(0, 10)}`;
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

    return NextResponse.json({ ok: true, id, status });
  } catch (err) {
    console.error("[manager/leave] failed:", err);
    return fail("SERVER_ERROR", "Could not process the request", 503);
  }
}
