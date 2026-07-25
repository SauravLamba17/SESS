// REPORT 7 — Recruitment Funnel.
//
// INPUT:  Applications created in the range, each with its current stage, its
//         requisition's department, and its created/updated timestamps.
// OUTPUT: how many applications reached each pipeline stage, the conversion
//         rate between consecutive stages, and average time-to-hire.
//
// HOW "REACHED" IS DERIVED — read before trusting the numbers:
// Application.stage holds the CURRENT stage only; this schema stores no stage
// history (by design — Phase 8 keeps every transition an auditable human click,
// but records the click in AuditLog, not as a per-application timeline). So
// "reached INTERVIEW" is inferred as "current stage is INTERVIEW or beyond".
//
// The one thing that inference cannot recover is how far a REJECTED candidate
// got before rejection: a rejection at offer stage and a rejection at screening
// are both just REJECTED. Rejections are therefore reported as their own line
// rather than being distributed back into the funnel — an honest gap, not a
// guess. Reconstructing it would need a stage-history table.
//
// Pure. No DB access.

import { pct } from "./types.ts";

export type PipelineStageLike =
  | "APPLIED"
  | "SCREENING"
  | "INTERVIEW"
  | "OFFER"
  | "HIRED"
  | "REJECTED";

/** Funnel order. REJECTED is deliberately NOT in it — it is terminal, off-funnel. */
export const FUNNEL_STAGES: PipelineStageLike[] = [
  "APPLIED",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
  "HIRED",
];

export interface ApplicationRow {
  id: string;
  department: string;
  stage: PipelineStageLike;
  createdAt: Date;
  /** Last transition time. For a HIRED row this is when it became HIRED. */
  updatedAt: Date;
}

export interface FunnelStageRow {
  stage: PipelineStageLike;
  /** Applications whose current stage is exactly this. */
  atStage: number;
  /** Applications that reached this stage or moved beyond it. */
  reached: number;
  /** reached(this) ÷ reached(previous) — null for the first stage. */
  conversionFromPrevPct: number | null;
  /** reached(this) ÷ total applications. */
  ofTotalPct: number | null;
}

export interface RecruitmentFunnelResult {
  totalApplications: number;
  stages: FunnelStageRow[];
  rejectedCount: number;
  rejectedPct: number | null;
  hiredCount: number;
  /** hired ÷ total applications — the headline funnel number. */
  overallConversionPct: number | null;
  /** Mean days from application created to HIRED, over hired applications. */
  avgTimeToHireDays: number | null;
  medianTimeToHireDays: number | null;
  byDepartment: {
    department: string;
    applications: number;
    hired: number;
    rejected: number;
    conversionPct: number | null;
  }[];
}

const DAY_MS = 86_400_000;

export function computeRecruitmentFunnel(
  applications: ApplicationRow[],
): RecruitmentFunnelResult {
  const total = applications.length;

  const stageIndex = (s: PipelineStageLike) => FUNNEL_STAGES.indexOf(s);

  const stages: FunnelStageRow[] = FUNNEL_STAGES.map((stage, i) => {
    const atStage = applications.filter((a) => a.stage === stage).length;
    // "Reached" = current stage at or beyond this one. REJECTED (index -1) is
    // excluded from every funnel band by construction.
    const reached = applications.filter((a) => {
      const idx = stageIndex(a.stage);
      return idx >= i;
    }).length;
    return {
      stage,
      atStage,
      reached,
      conversionFromPrevPct: null, // filled below, needs the previous row
      ofTotalPct: pct(reached, total),
    };
  });
  for (let i = 1; i < stages.length; i++) {
    stages[i].conversionFromPrevPct = pct(stages[i].reached, stages[i - 1].reached);
  }

  const rejected = applications.filter((a) => a.stage === "REJECTED");
  const hired = applications.filter((a) => a.stage === "HIRED");

  const hireDays = hired
    .map((a) => (a.updatedAt.getTime() - a.createdAt.getTime()) / DAY_MS)
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);

  const avgTimeToHireDays =
    hireDays.length > 0
      ? Math.round((hireDays.reduce((t, v) => t + v, 0) / hireDays.length) * 10) / 10
      : null;
  const medianTimeToHireDays =
    hireDays.length === 0
      ? null
      : hireDays.length % 2 === 1
        ? Math.round(hireDays[(hireDays.length - 1) / 2] * 10) / 10
        : Math.round(
            ((hireDays[hireDays.length / 2 - 1] + hireDays[hireDays.length / 2]) / 2) * 10,
          ) / 10;

  const deptMap = new Map<string, { applications: number; hired: number; rejected: number }>();
  for (const a of applications) {
    const d = deptMap.get(a.department) ?? { applications: 0, hired: 0, rejected: 0 };
    d.applications++;
    if (a.stage === "HIRED") d.hired++;
    if (a.stage === "REJECTED") d.rejected++;
    deptMap.set(a.department, d);
  }

  return {
    totalApplications: total,
    stages,
    rejectedCount: rejected.length,
    rejectedPct: pct(rejected.length, total),
    hiredCount: hired.length,
    overallConversionPct: pct(hired.length, total),
    avgTimeToHireDays,
    medianTimeToHireDays,
    byDepartment: Array.from(deptMap.entries())
      .map(([department, d]) => ({
        ...d,
        department,
        conversionPct: pct(d.hired, d.applications),
      }))
      .sort(
        (a, b) => b.applications - a.applications || a.department.localeCompare(b.department),
      ),
  };
}
