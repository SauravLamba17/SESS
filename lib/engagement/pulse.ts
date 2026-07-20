import "server-only";
import { db } from "@/lib/db";
import { computeAggregate, type PulseAggregate } from "./logic";

export type { PulseAggregate };

/**
 * Pulse-survey aggregation.
 *
 * The ONLY read path to PulseSurveyResponse in the codebase, and it returns
 * NUMBERS ONLY — never a row, never an id. Keeping this the single reader is
 * what makes the anonymity claim checkable: grep for `pulseSurveyResponse` and
 * you find the write in app/api/pulse/respond, and these two functions.
 *
 * Aggregation happens in SQL via groupBy, so individual ratings never even
 * enter application memory, let alone an HTTP response. Neither function below
 * accepts or returns an employee id in any form.
 */

export async function aggregateSurvey(
  surveyId: string,
  scaleMin: number,
  scaleMax: number,
): Promise<PulseAggregate> {
  const grouped = await db.pulseSurveyResponse.groupBy({
    by: ["ratingValue"],
    where: { surveyId },
    _count: { _all: true },
  });

  return computeAggregate(
    surveyId,
    grouped.map((g) => ({ ratingValue: g.ratingValue, count: g._count._all })),
    scaleMin,
    scaleMax,
  );
}

/**
 * Aggregates for many surveys at once — one groupBy across all of them, so a
 * page listing N surveys costs one query rather than N.
 */
export async function aggregateSurveys(
  surveys: { id: string; scaleMin: number; scaleMax: number }[],
): Promise<Map<string, PulseAggregate>> {
  const out = new Map<string, PulseAggregate>();
  const ids = surveys.map((s) => s.id);
  if (ids.length === 0) return out;

  const grouped = await db.pulseSurveyResponse.groupBy({
    by: ["surveyId", "ratingValue"],
    where: { surveyId: { in: ids } },
    _count: { _all: true },
  });

  for (const s of surveys) {
    out.set(
      s.id,
      computeAggregate(
        s.id,
        grouped
          .filter((g) => g.surveyId === s.id)
          .map((g) => ({ ratingValue: g.ratingValue, count: g._count._all })),
        s.scaleMin,
        s.scaleMax,
      ),
    );
  }

  return out;
}

/**
 * Which surveys has this employee already answered?
 *
 * Reads SurveyResponseRecord ONLY — the turnstile, which holds no ratings.
 * Returns a Set of surveyIds and nothing else, so there is no result shape
 * here capable of carrying an answer. This is the ONLY function that takes an
 * employeeId anywhere in the pulse subsystem, and it never touches
 * PulseSurveyResponse.
 */
export async function answeredSurveyIds(employeeId: string): Promise<Set<string>> {
  const records = await db.surveyResponseRecord.findMany({
    where: { employeeId },
    select: { surveyId: true },
  });
  return new Set(records.map((r) => r.surveyId));
}
