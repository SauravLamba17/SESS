import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, hasAtLeastRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { fail } from "@/lib/api/response";
import { lockCycleForWrite } from "@/lib/appraisal/cycle-lock";

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

  let body: {
    cycleId?: unknown;
    employeeId?: unknown;
    feedbackScore?: unknown;
    comment?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const cycleId = typeof body.cycleId === "string" ? body.cycleId : "";
  const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
  const feedbackScore = Number(body.feedbackScore);
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  if (
    !cycleId ||
    !employeeId ||
    !Number.isFinite(feedbackScore) ||
    feedbackScore < 0 ||
    feedbackScore > 100
  ) {
    return fail(
      "BAD_INPUT",
      "cycleId, employeeId and feedbackScore (0–100) are required",
      400,
    );
  }

  try {
    const manager = await getEmployeeByClerkId(userId);
    if (!manager)
      return fail("NO_EMPLOYEE", "No employee record linked to this account", 403);

    // Authorization + cycle lock + write in one transaction — the direct-report
    // check, the published check and the feedback upsert all commit together,
    // so a concurrent Publish cannot land between the check and the write.
    // See lib/appraisal/cycle-lock.ts.
    const result = await db.$transaction(async (tx) => {
      const gate = await lockCycleForWrite(tx, cycleId);
      if (!gate.ok) return gate.reason;

      const report = await tx.employee.findFirst({
        where: { id: employeeId, managerId: manager.id, active: true },
        select: { id: true },
      });
      if (!report) return "NOT_DIRECT_REPORT" as const;

      const score = await tx.appraisalScore.upsert({
        where: { employeeId_cycleId: { employeeId, cycleId } },
        create: {
          employeeId,
          cycleId,
          managerFeedbackScore: feedbackScore,
          managerFeedback: comment || null,
        },
        update: {
          managerFeedbackScore: feedbackScore,
          managerFeedback: comment || null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "APPRAISAL_FEEDBACK_SUBMITTED",
          targetEntity: score.id,
        },
      });
      return score;
    });

    if (result === "NOT_FOUND") return fail("NOT_FOUND", "Cycle not found", 404);
    if (result === "PUBLISHED")
      return fail("PUBLISHED", "Cycle is published; feedback is closed", 409);
    if (result === "NOT_DIRECT_REPORT")
      return fail("NOT_DIRECT_REPORT", "That employee is not your direct report", 403);

    return NextResponse.json({ ok: true, employeeId, cycleId, feedbackScore });
  } catch (err) {
    console.error("[manager/appraisal/feedback] failed:", err);
    return fail("SERVER_ERROR", "Could not save feedback", 503);
  }
}
