import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);

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

    const cycle = await db.appraisalCycle.findUnique({ where: { id: cycleId } });
    if (!cycle) return fail("NOT_FOUND", "Cycle not found", 404);
    if (cycle.published)
      return fail("PUBLISHED", "Cycle is published; feedback is closed", 409);

    // Authorization + write in one transaction — the direct-report check and
    // the feedback upsert commit together (same pattern as target/quality).
    const result = await db.$transaction(async (tx) => {
      const report = await tx.employee.findFirst({
        where: { id: employeeId, managerId: manager.id, active: true },
        select: { id: true },
      });
      if (!report) return null;

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

    if (!result)
      return fail("NOT_DIRECT_REPORT", "That employee is not your direct report", 403);

    return NextResponse.json({ ok: true, employeeId, cycleId, feedbackScore });
  } catch (err) {
    console.error("[manager/appraisal/feedback] failed:", err);
    return fail("SERVER_ERROR", "Could not save feedback", 503);
  }
}
