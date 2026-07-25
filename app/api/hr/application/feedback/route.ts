import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveRecruitmentScope, canAccessApplication } from "@/lib/recruitment/access";
import { withPrivilegedRoute } from "@/lib/mfa-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

/**
 * Add interview feedback, or save human-written review notes.
 *
 * Open to HR/Super Admin org-wide and to a MANAGER for their own department
 * only. The department check is server-side (lib/recruitment/access.ts) and
 * derives the manager's department from their own Employee record — a manager
 * cannot widen their scope by passing a different department in the request.
 *
 * Notes are free text typed by a person. Nothing here is generated, scored or
 * summarised by a machine.
 */
async function POSTHandler(req: NextRequest) {
  const scope = await resolveRecruitmentScope();
  if (!scope.ok)
    return fail(
      scope.code,
      scope.message,
      scope.code === "UNAUTHENTICATED" ? 401 : 403,
    );

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const applicationId = typeof body.applicationId === "string" ? body.applicationId : "";
  if (!applicationId) return fail("BAD_INPUT", "applicationId is required", 400);

  const access = await canAccessApplication(scope, applicationId);
  if (!access.ok)
    return fail(access.code, access.message, access.code === "NOT_FOUND" ? 404 : 403);

  try {
    // ── Review notes (human-authored, replaces previous notes) ──
    if (body.action === "notes") {
      const reviewNotes =
        typeof body.reviewNotes === "string" ? body.reviewNotes.trim().slice(0, 5000) : "";
      await db.application.update({
        where: { id: applicationId },
        data: { reviewNotes: reviewNotes || null },
      });
      return NextResponse.json({ ok: true, applicationId });
    }

    // ── Interview feedback ──
    const ratingRaw = body.rating;
    const rating =
      typeof ratingRaw === "number"
        ? Math.trunc(ratingRaw)
        : Number.parseInt(String(ratingRaw ?? ""), 10);
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    const dateStr = typeof body.interviewDate === "string" ? body.interviewDate.trim() : "";

    // Which interview round this feedback belongs to. Defaults to 1 when the
    // caller omits it, matching the column default.
    const roundRaw = body.roundNumber;
    const roundNumber =
      roundRaw === undefined || roundRaw === null || roundRaw === ""
        ? 1
        : typeof roundRaw === "number"
          ? Math.trunc(roundRaw)
          : Number.parseInt(String(roundRaw), 10);

    if (!Number.isFinite(rating) || rating < 1 || rating > 5)
      return fail("BAD_INPUT", "rating must be a whole number from 1 to 5", 400);
    // Capped at a sane ceiling — a typo of 99 rounds would render a very silly
    // page, and no real process runs more than a handful.
    if (!Number.isFinite(roundNumber) || roundNumber < 1 || roundNumber > 20)
      return fail("BAD_INPUT", "roundNumber must be a whole number from 1 to 20", 400);
    if (!notes) return fail("BAD_INPUT", "Interview notes are required", 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr))
      return fail("BAD_INPUT", "interviewDate must be a valid YYYY-MM-DD date", 400);

    const [y, m, d] = dateStr.split("-").map(Number);
    const interviewDate = new Date(y, m - 1, d);
    if (Number.isNaN(interviewDate.getTime()))
      return fail("BAD_INPUT", "interviewDate is not a valid date", 400);

    const created = await db.$transaction(async (tx) => {
      const fb = await tx.interviewFeedback.create({
        data: {
          applicationId,
          interviewerUserId: scope.userId,
          rating,
          notes: notes.slice(0, 5000),
          interviewDate,
          roundNumber,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: scope.userId,
          action: "INTERVIEW_FEEDBACK_ADDED",
          targetEntity: `${applicationId} (round ${roundNumber}, rating ${rating}/5)`,
        },
      });
      return fb;
    });

    return NextResponse.json({ ok: true, id: created.id });
  } catch (err) {
    console.error("[hr/application/feedback] failed:", err);
    return fail("SERVER_ERROR", "Could not save the feedback", 503);
  }
}

// MFA gate — see lib/mfa-guard.ts. Rejects only when the caller's role
// requires two-factor auth and it is not enabled; every other status this
// route returns is produced by the handler above, unchanged.
export const POST = withPrivilegedRoute(POSTHandler);
