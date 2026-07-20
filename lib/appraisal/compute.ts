// Pure appraisal score computation. No DB access — callers batch-fetch all
// metrics (see Step 9) and pass already-aggregated numbers in, so a whole
// department can be scored without an N+1.

export interface AppraisalWeights {
  punctuality: number;
  production: number;
  quality: number;
  feedback: number;
  warningPenaltyPoints: number;
  // Phase 8: internal split of the punctuality component into frequency vs
  // severity, plus the minutes-late cap at which severity bottoms out.
  // (freq + sev sum to 100; validated at save. Defaulted here for safety when
  // an older snapshot lacks them — see resolvePunctualityConfig.)
  punctualityFrequencyWeight?: number;
  punctualitySeverityWeight?: number;
  punctualitySeverityCapMinutes?: number;
}

/** Suggested defaults, referenced by the API/UI and used as the safety fallback. */
export const PUNCTUALITY_DEFAULTS = {
  punctualityFrequencyWeight: 70,
  punctualitySeverityWeight: 30,
  punctualitySeverityCapMinutes: 60,
} as const;

/** Pre-aggregated metrics for one employee over the cycle's period. */
export interface EmployeeMetrics {
  totalPunchDays: number; // count of Attendance rows in period
  lateCount: number; // count with lateFlag = true
  lateMinutesSum: number; // sum of lateMinutes over ONLY the late-flagged rows (nulls treated as 0 by the DB _sum)
  unitsProduced: number; // sum(Production.unitsProduced)
  targetUnits: number | null; // sum of MonthlyTarget.targetUnits over period, null if none
  qualityAvg: number | null; // avg(QualityReport.qualityScore), already 0-100, null if none
  feedbackScore: number | null; // managerFeedbackScore 0-100, null if not entered
  releasedWarnings: number; // count of RELEASED WarningLetter releasedAt in period
}

export type ComponentKey = "punctuality" | "production" | "quality" | "feedback";

export interface ComponentDatum {
  hasData: boolean;
  value: number | null; // component value 0-100 (null when no data)
  weight: number;
}

/** The two-part frequency + severity breakdown behind the punctuality value. */
export interface PunctualityBreakdown {
  frequencyScore: number; // (1 - lateCount/totalPunchDays) * 100
  severityScore: number; // 100 among the LATE days only; 100 when never late
  lateCount: number;
  totalPunchDays: number;
  avgLateMinutesAmongLateDays: number; // 0 when lateCount === 0
  frequencyWeight: number;
  severityWeight: number;
  severityCapMinutes: number;
}

export interface PunctualityDatum extends ComponentDatum {
  breakdown: PunctualityBreakdown | null; // null when no data (no punch days)
}

export interface ComponentData {
  punctuality: PunctualityDatum;
  production: ComponentDatum;
  quality: ComponentDatum;
  feedback: ComponentDatum;
  warningPenalty: { releasedWarnings: number; pointsEach: number; total: number };
}

export type AppraisalResult =
  | {
      status: "COMPLETE";
      employeeId: string;
      finalScore: number;
      weightedAverage: number;
      componentData: ComponentData;
    }
  | {
      status: "INCOMPLETE";
      employeeId: string;
      missingComponents: ComponentKey[];
      componentData: ComponentData;
    };

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Resolve the punctuality sub-config, defaulting safely if a snapshot lacks it. */
function resolvePunctualityConfig(weights: AppraisalWeights) {
  let freqW = Number(weights.punctualityFrequencyWeight);
  let sevW = Number(weights.punctualitySeverityWeight);
  if (!Number.isFinite(freqW) || !Number.isFinite(sevW) || freqW + sevW <= 0) {
    freqW = PUNCTUALITY_DEFAULTS.punctualityFrequencyWeight;
    sevW = PUNCTUALITY_DEFAULTS.punctualitySeverityWeight;
  }
  let cap = Number(weights.punctualitySeverityCapMinutes);
  if (!Number.isFinite(cap) || cap <= 0) cap = PUNCTUALITY_DEFAULTS.punctualitySeverityCapMinutes;
  return { freqW, sevW, cap };
}

/**
 * Two-part punctuality (Phase 8). Returns { value 0-100, breakdown } or null
 * when there is no punch data in the period (component missing → INCOMPLETE).
 *
 * frequency: how OFTEN late — (1 - lateCount/totalPunchDays)*100.
 * severity:  how LATE on the days that WERE late only (on-time days excluded,
 *            so a single severe incident is not diluted by frequency). 100 when
 *            never late. Bottoms out at 0 once avg late reaches the cap.
 */
function punctualityValue(
  m: EmployeeMetrics,
  weights: AppraisalWeights,
): { value: number; breakdown: PunctualityBreakdown } | null {
  if (m.totalPunchDays <= 0) return null;
  const { freqW, sevW, cap } = resolvePunctualityConfig(weights);

  const frequencyScore = clamp((1 - m.lateCount / m.totalPunchDays) * 100, 0, 100);

  let avgLate = 0;
  let severityScore: number;
  if (m.lateCount === 0) {
    severityScore = 100; // never late → severity trivially perfect
  } else {
    avgLate = m.lateMinutesSum / m.lateCount; // ONLY across late days
    severityScore = clamp(100 - (avgLate / cap) * 100, 0, 100); // max(0, …)
  }

  const value = clamp(
    frequencyScore * (freqW / 100) + severityScore * (sevW / 100),
    0,
    100,
  );

  return {
    value,
    breakdown: {
      frequencyScore,
      severityScore,
      lateCount: m.lateCount,
      totalPunchDays: m.totalPunchDays,
      avgLateMinutesAmongLateDays: avgLate,
      frequencyWeight: freqW,
      severityWeight: sevW,
      severityCapMinutes: cap,
    },
  };
}

function productionValue(m: EmployeeMetrics): number | null {
  // No target set → no data (do not fabricate a ratio). Capped at 100.
  if (m.targetUnits === null || m.targetUnits <= 0) return null;
  return clamp((m.unitsProduced / m.targetUnits) * 100, 0, 100);
}

function qualityValue(m: EmployeeMetrics): number | null {
  if (m.qualityAvg === null) return null;
  // QualityReport.qualityScore is already stored 0-100 (Phase 3 form); use as-is.
  return clamp(m.qualityAvg, 0, 100);
}

/**
 * Compute an employee's appraisal result.
 *
 * INCOMPLETE (no finalScore) when any of punctuality/production/quality lacks
 * data. Feedback is the soft exception: if feedbackScore is null it is only
 * missing-but-blocking unless `allowMissingFeedback` is set (HR acknowledged),
 * in which case the weighted average is renormalized over the present weights.
 */
export function computeAppraisal(
  employeeId: string,
  weights: AppraisalWeights,
  m: EmployeeMetrics,
  opts: { allowMissingFeedback: boolean },
): AppraisalResult {
  const punct = punctualityValue(m, weights);
  const pVal = punct ? punct.value : null;
  const prodVal = productionValue(m);
  const qVal = qualityValue(m);
  const fVal = m.feedbackScore;

  const componentData: ComponentData = {
    punctuality: {
      hasData: pVal !== null,
      value: pVal,
      weight: weights.punctuality,
      breakdown: punct ? punct.breakdown : null,
    },
    production: { hasData: prodVal !== null, value: prodVal, weight: weights.production },
    quality: { hasData: qVal !== null, value: qVal, weight: weights.quality },
    feedback: { hasData: fVal !== null, value: fVal, weight: weights.feedback },
    warningPenalty: {
      releasedWarnings: m.releasedWarnings,
      pointsEach: weights.warningPenaltyPoints,
      total: m.releasedWarnings * weights.warningPenaltyPoints,
    },
  };

  // Hard components: all three must have data.
  const hardMissing: ComponentKey[] = [];
  if (pVal === null) hardMissing.push("punctuality");
  if (prodVal === null) hardMissing.push("production");
  if (qVal === null) hardMissing.push("quality");

  if (hardMissing.length > 0) {
    const missing = [...hardMissing];
    if (fVal === null) missing.push("feedback");
    return { status: "INCOMPLETE", employeeId, missingComponents: missing, componentData };
  }

  // Feedback missing and not acknowledged → still INCOMPLETE, but only on feedback.
  if (fVal === null && !opts.allowMissingFeedback) {
    return { status: "INCOMPLETE", employeeId, missingComponents: ["feedback"], componentData };
  }

  // Weighted average over the components that have data.
  let num = pVal! * weights.punctuality + prodVal! * weights.production + qVal! * weights.quality;
  let den = weights.punctuality + weights.production + weights.quality;
  if (fVal !== null) {
    num += fVal * weights.feedback;
    den += weights.feedback;
  }
  const weightedAverage = den > 0 ? num / den : 0;
  const penalty = m.releasedWarnings * weights.warningPenaltyPoints;
  const finalScore = clamp(weightedAverage - penalty, 0, 100);

  return { status: "COMPLETE", employeeId, finalScore, weightedAverage, componentData };
}
