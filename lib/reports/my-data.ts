// REPORT 11 — My Data Export (self-service).
//
// INPUT:  one employee's own records, already fetched and already filtered by
//         the route, plus the range.
// OUTPUT: a structured manifest of everything SESS holds about that person.
//
// ─── SELF-SCOPE IS ENFORCED BEFORE THIS FUNCTION IS REACHED ──────────────
// This function has NO employeeId parameter and no notion of "whose" data it
// is being given — it formats whatever rows it receives. The identity comes
// from the session in lib/reports/scope.ts (mode "self"), which resolves the
// caller's own Employee row via getEmployeeByClerkId() and never reads an id
// from the request. There is therefore no argument a caller could supply, at
// any layer, that would point this at somebody else.
// ─────────────────────────────────────────────────────────────────────────
//
// TWO DELIBERATE EXCLUSIONS, both filtered here as well as in the query so the
// rule is testable without a database:
//   · appraisal scores from UNPUBLISHED cycles — an in-progress score is not
//     yet the employee's result and may still change
//   · DRAFT warning letters — a draft has never been issued to the employee
//
// Payslip PDFs are NOT re-embedded: they already have their own download, and
// duplicating a legal document into a summary invites the two disagreeing.
// What appears here is a payslip INDEX, so the employee knows what exists.
//
// Pure. No DB access.

import type { DateRange } from "./range.ts";

export interface MyProfile {
  name: string;
  employeeCode: string;
  department: string;
  designation: string | null;
  joiningDate: Date;
  emergencyContact: string | null;
  email: string | null;
  shiftName: string | null;
  managerName: string | null;
  active: boolean;
  offboardedAt: Date | null;
}

export interface MyAttendanceRow {
  date: Date;
  checkIn: Date | null;
  checkOut: Date | null;
  lateFlag: boolean;
  lateMinutes: number | null;
  channel: string;
  flaggedForReview: boolean;
}

export interface MyLeaveRow {
  startDate: Date;
  endDate: Date;
  reason: string;
  status: string;
  createdAt: Date;
}

export interface MyProductionRow {
  date: Date;
  unitsProduced: number;
  targetUnits: number;
}

export interface MyQualityRow {
  date: Date;
  defectCount: number;
  qualityScore: number;
}

export interface MyAppraisalRow {
  cyclePeriod: string;
  published: boolean;
  excluded: boolean;
  finalScore: number | null;
  managerFeedback: string | null;
}

export interface MyWarningRow {
  reason: string;
  status: string;
  releasedAt: Date | null;
  acknowledged: boolean;
  attestedAt: Date | null;
}

export interface MyConsentRow {
  consentType: string;
  givenOn: Date;
  retentionExpiry: Date | null;
}

export interface MyExpenseRow {
  date: Date;
  category: string;
  amount: string;
  description: string;
  status: string;
}

export interface MyPayslipRow {
  month: string;
  status: string;
  net: string;
}

export interface MyDataInput {
  profile: MyProfile;
  attendance: MyAttendanceRow[];
  leave: MyLeaveRow[];
  production: MyProductionRow[];
  quality: MyQualityRow[];
  appraisals: MyAppraisalRow[];
  warnings: MyWarningRow[];
  consents: MyConsentRow[];
  expenses: MyExpenseRow[];
  payslips: MyPayslipRow[];
}

export interface MyDataResult {
  profile: MyProfile;
  attendance: MyAttendanceRow[];
  attendanceSummary: {
    days: number;
    late: number;
    flagged: number;
  };
  leave: MyLeaveRow[];
  production: MyProductionRow[];
  productionSummary: { days: number; actual: number; target: number };
  quality: MyQualityRow[];
  qualitySummary: { reviews: number; averageScore: number | null };
  /** PUBLISHED, non-excluded cycles only. */
  appraisals: MyAppraisalRow[];
  /** RELEASED only. */
  warnings: MyWarningRow[];
  consents: MyConsentRow[];
  expenses: MyExpenseRow[];
  /** Index only — the PDFs themselves are downloaded from Payslips. */
  payslips: MyPayslipRow[];
  /** Section → row count, printed up front so the employee can see the shape. */
  counts: Record<string, number>;
  range: { startLabel: string; endLabel: string };
}

export function computeMyData(input: MyDataInput, range: DateRange): MyDataResult {
  // Re-apply the two exclusions independently of the query that fetched them.
  const appraisals = input.appraisals.filter((a) => a.published && !a.excluded);
  const warnings = input.warnings.filter((w) => w.status === "RELEASED");

  const productionActual = input.production.reduce((n, p) => n + p.unitsProduced, 0);
  const productionTarget = input.production.reduce((n, p) => n + p.targetUnits, 0);

  const qualityScores = input.quality.map((q) => q.qualityScore);
  const averageScore =
    qualityScores.length > 0
      ? Math.round((qualityScores.reduce((t, v) => t + v, 0) / qualityScores.length) * 10) / 10
      : null;

  return {
    profile: input.profile,
    attendance: input.attendance,
    attendanceSummary: {
      days: input.attendance.length,
      late: input.attendance.filter((a) => a.lateFlag).length,
      flagged: input.attendance.filter((a) => a.flaggedForReview).length,
    },
    leave: input.leave,
    production: input.production,
    productionSummary: {
      days: input.production.length,
      actual: productionActual,
      target: productionTarget,
    },
    quality: input.quality,
    qualitySummary: { reviews: input.quality.length, averageScore },
    appraisals,
    warnings,
    consents: input.consents,
    expenses: input.expenses,
    payslips: input.payslips,
    counts: {
      Attendance: input.attendance.length,
      Leave: input.leave.length,
      Production: input.production.length,
      Quality: input.quality.length,
      Appraisals: appraisals.length,
      Warnings: warnings.length,
      Consents: input.consents.length,
      Expenses: input.expenses.length,
      Payslips: input.payslips.length,
    },
    range: { startLabel: range.startLabel, endLabel: range.endLabel },
  };
}
