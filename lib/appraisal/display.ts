// Appraisal DISPLAY transform — 0-100 internally, X/5 to humans.
//
// ─── THIS FILE CHANGES NOTHING ABOUT HOW SCORES ARE CALCULATED ───────────
// lib/appraisal/compute.ts still produces, and the database still stores,
// scores on 0-100. Every threshold, every comparison, every "is this cycle
// COMPLETE enough to publish" check keeps operating on those real values.
//
// The only thing here is a formatter for the last inch before a number reaches
// a person's eyes. Nothing in this module is ever fed back into a comparison,
// a stored field, or a route's request body. If you find yourself parsing a
// string produced here back into a number, something has gone wrong.
//
// Why /5 at all: "79" reads as a percentage and invites "why did I lose 21%".
// "4.0/5" reads as a rating, which is what an appraisal actually is.
// ─────────────────────────────────────────────────────────────────────────
//
// Pure. No DB, no I/O.

/** The divisor. 100 internal points map onto a 5-point scale. */
export const SCALE_DIVISOR = 20;

/** Shown wherever a score exists but the employee has no published result. */
export const NOT_APPRAISED = "Not yet appraised";

/** Shown for a component that ran with no underlying data. */
export const NO_DATA = "no data";

/**
 * A 0-100 score as "X.X/5".
 *
 * null → NOT_APPRAISED, matching the existing empty state rather than
 * inventing a new one. A non-finite value is treated as absent instead of
 * rendering "NaN/5" at someone.
 */
export function formatScoreOutOfFive(score0to100: number | null | undefined): string {
  if (score0to100 === null || score0to100 === undefined || !Number.isFinite(score0to100)) {
    return NOT_APPRAISED;
  }
  return `${(score0to100 / SCALE_DIVISOR).toFixed(1)}/5`;
}

/**
 * The bare number, no "/5" suffix — for tight spots like a stat card where
 * the unit is already in the label, or a table column headed "Score (of 5)".
 */
export function scoreOutOfFive(score0to100: number | null | undefined): string | null {
  if (score0to100 === null || score0to100 === undefined || !Number.isFinite(score0to100)) {
    return null;
  }
  return (score0to100 / SCALE_DIVISOR).toFixed(1);
}

/**
 * An individual component (punctuality, production, quality, feedback) or one
 * of punctuality's frequency/severity halves.
 *
 * Same maths as the overall score — components are on the same 0-100 basis —
 * but with its own name so call sites read as what they are, and so the two
 * could diverge later without hunting down every usage.
 */
export function formatComponentOutOf5(value0to100: number | null | undefined): string {
  if (value0to100 === null || value0to100 === undefined || !Number.isFinite(value0to100)) {
    return NO_DATA;
  }
  return `${(value0to100 / SCALE_DIVISOR).toFixed(1)}/5`;
}

/**
 * A band boundary expressed on the 5-point scale, for the distribution report.
 *
 * The BANDS THEMSELVES ARE NOT REDEFINED — lib/reports/appraisal-distribution.ts
 * still buckets on the real 0-100 values, and bandIndexOf() is untouched. This
 * only relabels "0–40" as "0.0–2.0" so the chart axis matches what the rest of
 * the product shows.
 */
export function formatBandLabelOutOfFive(min: number, max: number): string {
  return `${(min / SCALE_DIVISOR).toFixed(1)}–${(max / SCALE_DIVISOR).toFixed(1)}`;
}
