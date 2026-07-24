import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { engagementEnabled } from "@/lib/system-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

/**
 * Submit a pulse-survey response. Open to every role.
 *
 * ── HOW ANONYMITY IS ENFORCED ─────────────────────────────────────────────
 *
 * Two rows are written in one transaction, to two models that share NOTHING:
 *
 *   PulseSurveyResponse  { surveyId, ratingValue }   ← the answer, no person
 *   SurveyResponseRecord { surveyId, employeeId }    ← the person, no answer
 *
 * They have no foreign key to each other, no shared id, and no correlating
 * column. Even holding both tables, there is no join that recovers who said
 * what — the link does not exist to be followed, rather than existing and
 * being politely ignored.
 *
 * Two deliberate details:
 *  • The employeeId comes from the SESSION, never the request body, so a
 *    caller cannot vote as someone else.
 *  • The record is written BEFORE the response, so if the unique constraint
 *    trips on a concurrent double-submit the whole transaction rolls back and
 *    no orphan rating is left behind.
 */
export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);

  // Phase 11: org-wide engagement pause (Module Toggles).
  if (!(await engagementEnabled()))
    return fail("MODULE_DISABLED", "The engagement module is currently paused by the administrator.", 403);

  let body: { surveyId?: unknown; ratingValue?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const surveyId = typeof body.surveyId === "string" ? body.surveyId : "";
  const raw = body.ratingValue;
  const ratingValue =
    typeof raw === "number" ? Math.trunc(raw) : Number.parseInt(String(raw ?? ""), 10);

  if (!surveyId) return fail("BAD_INPUT", "surveyId is required", 400);
  if (!Number.isFinite(ratingValue))
    return fail("BAD_INPUT", "Choose a rating before submitting", 400);

  try {
    const me = await getEmployeeByClerkId(userId);
    if (!me)
      return fail(
        "NO_EMPLOYEE",
        "No employee record is linked to your account, so you can't respond yet.",
        403,
      );

    const survey = await db.pulseSurvey.findUnique({
      where: { id: surveyId },
      select: { id: true, active: true, closesAt: true, scaleMin: true, scaleMax: true },
    });
    if (!survey) return fail("NOT_FOUND", "Survey not found", 404);
    if (!survey.active) return fail("CLOSED", "This survey is closed.", 409);
    if (survey.closesAt && survey.closesAt <= new Date())
      return fail("CLOSED", "This survey has closed.", 409);

    if (ratingValue < survey.scaleMin || ratingValue > survey.scaleMax)
      return fail(
        "BAD_INPUT",
        `Rating must be between ${survey.scaleMin} and ${survey.scaleMax}`,
        400,
      );

    // Friendly pre-check. The unique constraint below is the real guarantee —
    // this exists so the common case gets a clear message rather than a
    // constraint error.
    const already = await db.surveyResponseRecord.findUnique({
      where: { surveyId_employeeId: { surveyId, employeeId: me.id } },
      select: { id: true },
    });
    if (already)
      return fail(
        "ALREADY_RESPONDED",
        "You've already responded to this survey. Thank you — responses can't be changed, which is part of how they stay anonymous.",
        409,
      );

    await db.$transaction(async (tx) => {
      // Turnstile first: if this throws P2002 on a concurrent submit, the
      // rating below is never written.
      await tx.surveyResponseRecord.create({
        data: { surveyId, employeeId: me.id },
      });
      // The answer. No employeeId — the field does not exist on this model.
      await tx.pulseSurveyResponse.create({
        data: { surveyId, ratingValue },
      });
    });

    return NextResponse.json({ ok: true, surveyId });
  } catch (err) {
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002")
      return fail(
        "ALREADY_RESPONDED",
        "You've already responded to this survey.",
        409,
      );
    console.error("[pulse/respond] failed:", err);
    return fail("SERVER_ERROR", "Could not record your response", 503);
  }
}
