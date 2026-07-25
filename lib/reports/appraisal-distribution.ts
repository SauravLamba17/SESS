// REPORT 5 — Appraisal Score Distribution.
//
// INPUT:  published, non-excluded AppraisalScore rows with a final score, each
//         carrying its employee's department and its cycle's period.
// OUTPUT: the count and share of scores in each band, the org average, and the
//         average per department and per cycle.
//
// Bands are HALF-OPEN — [0,40) [40,60) [60,80) [80,100] — so every score lands
// in exactly one, and a perfect 100 lands in the top band rather than falling
// off the end. The scores themselves are NOT recomputed here: they are the
// finalScore values lib/appraisal/compute.ts already produced and HR published.
//
// Pure. No DB access.

import { pct } from "./types.ts";

export interface AppraisalScoreRow {
  employeeId: string;
  name: string;
  employeeCode: string;
  department: string;
  cyclePeriod: string;
  finalScore: number;
}

export interface ScoreBand {
  label: string;
  min: number;
  /** Exclusive, except on the top band. */
  max: number;
  count: number;
  sharePct: number | null;
}

export const BAND_DEFS: { label: string; min: number; max: number }[] = [
  { label: "0–40", min: 0, max: 40 },
  { label: "40–60", min: 40, max: 60 },
  { label: "60–80", min: 60, max: 80 },
  { label: "80–100", min: 80, max: 100 },
];

/** Index of the band a score falls in. Top band is inclusive of its max. */
export function bandIndexOf(score: number): number {
  for (let i = 0; i < BAND_DEFS.length; i++) {
    const b = BAND_DEFS[i];
    const isTop = i === BAND_DEFS.length - 1;
    if (score >= b.min && (isTop ? score <= b.max : score < b.max)) return i;
  }
  // Out of range (shouldn't happen — compute.ts clamps 0-100) — clamp to an end.
  return score < 0 ? 0 : BAND_DEFS.length - 1;
}

export interface AppraisalDistributionResult {
  scoredCount: number;
  average: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  bands: ScoreBand[];
  byDepartment: { department: string; count: number; average: number | null }[];
  byCycle: { cyclePeriod: string; count: number; average: number | null }[];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((t, v) => t + v, 0) / values.length) * 10) / 10;
}

export function computeAppraisalDistribution(
  scores: AppraisalScoreRow[],
): AppraisalDistributionResult {
  const values = scores.map((s) => s.finalScore);

  const bandCounts = BAND_DEFS.map(() => 0);
  for (const v of values) bandCounts[bandIndexOf(v)]++;

  const bands: ScoreBand[] = BAND_DEFS.map((b, i) => ({
    ...b,
    count: bandCounts[i],
    sharePct: pct(bandCounts[i], values.length),
  }));

  const sorted = [...values].sort((a, b) => a - b);
  const median =
    sorted.length === 0
      ? null
      : sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : Math.round(((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) * 10) / 10;

  const deptMap = new Map<string, number[]>();
  for (const s of scores) {
    const arr = deptMap.get(s.department) ?? [];
    arr.push(s.finalScore);
    deptMap.set(s.department, arr);
  }
  const byDepartment = Array.from(deptMap.entries())
    .map(([department, vals]) => ({ department, count: vals.length, average: mean(vals) }))
    .sort((a, b) => (b.average ?? 0) - (a.average ?? 0) || a.department.localeCompare(b.department));

  const cycleMap = new Map<string, number[]>();
  for (const s of scores) {
    const arr = cycleMap.get(s.cyclePeriod) ?? [];
    arr.push(s.finalScore);
    cycleMap.set(s.cyclePeriod, arr);
  }
  const byCycle = Array.from(cycleMap.entries())
    .map(([cyclePeriod, vals]) => ({ cyclePeriod, count: vals.length, average: mean(vals) }))
    .sort((a, b) => a.cyclePeriod.localeCompare(b.cyclePeriod));

  return {
    scoredCount: values.length,
    average: mean(values),
    median,
    min: sorted.length > 0 ? sorted[0] : null,
    max: sorted.length > 0 ? sorted[sorted.length - 1] : null,
    bands,
    byDepartment,
    byCycle,
  };
}
