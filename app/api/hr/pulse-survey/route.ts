import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseDateOnly } from "@/lib/period";
import { aggregateSurvey } from "@/lib/engagement/pulse";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create / close a pulse survey (HR + Super Admin).
 *
 * There is deliberately no endpoint anywhere that returns individual
 * responses — see GET below, which returns aggregates only.
 */
export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may manage pulse surveys", 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const action = typeof body.action === "string" ? body.action : "create";

  try {
    if (action === "close" || action === "reopen") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return fail("BAD_INPUT", "id is required", 400);
      const upd = await db.pulseSurvey.updateMany({
        where: { id },
        data: { active: action === "reopen" },
      });
      if (upd.count === 0) return fail("NOT_FOUND", "Survey not found", 404);
      return NextResponse.json({ ok: true, id, active: action === "reopen" });
    }

    // ── create ──
    const question = typeof body.question === "string" ? body.question.trim() : "";
    const minRaw = body.scaleMin;
    const maxRaw = body.scaleMax;
    const scaleMin =
      minRaw === undefined || minRaw === null || minRaw === ""
        ? 1
        : typeof minRaw === "number"
          ? Math.trunc(minRaw)
          : Number.parseInt(String(minRaw), 10);
    const scaleMax =
      maxRaw === undefined || maxRaw === null || maxRaw === ""
        ? 5
        : typeof maxRaw === "number"
          ? Math.trunc(maxRaw)
          : Number.parseInt(String(maxRaw), 10);

    if (!question || question.length > 300)
      return fail("BAD_INPUT", "A question is required (under 300 characters)", 400);
    if (!Number.isFinite(scaleMin) || !Number.isFinite(scaleMax))
      return fail("BAD_INPUT", "scaleMin and scaleMax must be whole numbers", 400);
    if (scaleMin >= scaleMax)
      return fail("BAD_INPUT", "scaleMax must be greater than scaleMin", 400);
    // A scale wider than ~10 points stops being a pulse and starts being a
    // free-text box with extra steps.
    if (scaleMin < 0 || scaleMax > 10)
      return fail("BAD_INPUT", "Keep the scale between 0 and 10", 400);

    let closesAt: Date | null = null;
    const closesStr = typeof body.closesAt === "string" ? body.closesAt.trim() : "";
    if (closesStr) {
      const closesDay = parseDateOnly(closesStr);
      if (!closesDay)
        return fail("BAD_INPUT", "closesAt must be a valid YYYY-MM-DD date", 400);
      // End of the chosen day, so a survey closing "today" is open all day.
      closesAt = new Date(
        closesDay.getFullYear(),
        closesDay.getMonth(),
        closesDay.getDate() + 1,
      );
    }

    const created = await db.pulseSurvey.create({
      data: { question, scaleMin, scaleMax, closesAt, createdBy: userId },
    });

    return NextResponse.json({ ok: true, id: created.id });
  } catch (err) {
    console.error("[hr/pulse-survey] failed:", err);
    return fail("SERVER_ERROR", "Could not save the survey", 503);
  }
}

/**
 * Aggregate results for one survey.
 *
 * Returns ONLY numbers: a response count, an average, and a per-rating count.
 * The aggregation happens in SQL (see lib/engagement/pulse.ts), so no
 * individual response row is loaded into memory, and none could be serialised
 * into this response even by accident.
 */
export async function GET(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may view survey results", 403);

  const surveyId = (new URL(req.url).searchParams.get("surveyId") ?? "").trim();
  if (!surveyId) return fail("BAD_INPUT", "surveyId is required", 400);

  try {
    const survey = await db.pulseSurvey.findUnique({
      where: { id: surveyId },
      select: { id: true, question: true, scaleMin: true, scaleMax: true },
    });
    if (!survey) return fail("NOT_FOUND", "Survey not found", 404);

    const agg = await aggregateSurvey(survey.id, survey.scaleMin, survey.scaleMax);

    return NextResponse.json({
      ok: true,
      surveyId: survey.id,
      question: survey.question,
      responseCount: agg.responseCount,
      average: agg.average,
      distribution: agg.distribution,
    });
  } catch (err) {
    console.error("[hr/pulse-survey GET] failed:", err);
    return fail("SERVER_ERROR", "Could not load results", 503);
  }
}
