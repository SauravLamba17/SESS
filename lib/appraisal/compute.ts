// Pure appraisal score computation. No DB access — callers batch-fetch all
// metrics (see Step 9) and pass already-aggregated numbers in, so a whole
// department can be scored without an N+1.

export interface AppraisalWeights {
  punctuality: number;
  production: number;
  quality: number;
  feedback: number;
  warningPenaltyPoints: number;
}

/** Pre-aggregated metrics for one employee over the cycle's period. */
export interface EmployeeMetrics {
  totalPunchDays: number; // count of Attendance rows in period
  lateCount: number; // count with lateFlag = true
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

export interface ComponentData {
  punctuality: ComponentDatum;
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

/** Component values 0-100, or null when the component has no data. */
function punctualityValue(m: EmployeeMetrics): number | null {
  if (m.totalPunchDays <= 0) return null;
  return clamp((1 - m.lateCount / m.totalPunchDays) * 100, 0, 100);
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
  const pVal = punctualityValue(m);
  const prodVal = productionValue(m);
  const qVal = qualityValue(m);
  const fVal = m.feedbackScore;

  const componentData: ComponentData = {
    punctuality: { hasData: pVal !== null, value: pVal, weight: weights.punctuality },
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
