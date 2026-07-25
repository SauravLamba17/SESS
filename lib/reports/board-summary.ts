// REPORT 10 — Monthly/Quarterly Board Summary.
//
// INPUT:  the raw datasets the five underlying reports need, plus the range.
// OUTPUT: one combined object of headline numbers for a board pack.
//
// ─── THIS FILE COMPUTES NOTHING ITSELF ───────────────────────────────────
// Every number below is read off the result of another report's pure function:
//
//   computeHeadcount()             → headcount, department count
//   computeHiresExits()            → hires, exits, attrition
//   computeAppraisalDistribution() → average score, distribution
//   computePayrollCost()           → cost to company (FINALIZED only)
//   computeRecruitmentFunnel()     → applications, hires, time-to-hire
//
// There is deliberately no arithmetic here beyond reading fields off those
// results, so a board number can never drift from the detailed report it claims
// to summarise. The sub-results are returned alongside the headlines precisely
// so this is verifiable: prisma/verify-phase12.ts asserts the board's numbers
// are IDENTICAL to running each report standalone over the same range.
// ─────────────────────────────────────────────────────────────────────────
//
// Pure. No DB access.

import type { DateRange } from "./range.ts";
import type { ReportEmployee } from "./types.ts";
import { computeHeadcount, type HeadcountResult } from "./headcount.ts";
import { computeHiresExits, type HiresExitsResult } from "./hires-exits.ts";
import {
  computeAppraisalDistribution,
  type AppraisalDistributionResult,
  type AppraisalScoreRow,
} from "./appraisal-distribution.ts";
import { computePayrollCost, type PayrollCostResult, type PayrollCostRow } from "./payroll-cost.ts";
import {
  computeRecruitmentFunnel,
  type ApplicationRow,
  type RecruitmentFunnelResult,
} from "./recruitment-funnel.ts";

export interface BoardSummaryInput {
  employees: ReportEmployee[];
  appraisalScores: AppraisalScoreRow[];
  payrollRows: PayrollCostRow[];
  applications: ApplicationRow[];
}

export interface BoardHeadline {
  label: string;
  value: string;
  /** Where the number came from — printed in the PDF so a board member can
   *  ask for the detailed report behind any line. */
  source: string;
}

export interface BoardSummaryResult {
  headlines: BoardHeadline[];
  /** The untouched sub-results. Same objects the standalone reports return. */
  headcount: HeadcountResult;
  hiresExits: HiresExitsResult;
  appraisal: AppraisalDistributionResult;
  payroll: PayrollCostResult;
  recruitment: RecruitmentFunnelResult;
}

function num(n: number | null, suffix = ""): string {
  return n === null ? "—" : `${n}${suffix}`;
}

export function computeBoardSummary(
  input: BoardSummaryInput,
  range: DateRange,
): BoardSummaryResult {
  // The five delegations. Nothing else in this file touches the raw input.
  const headcount = computeHeadcount(input.employees, range);
  const hiresExits = computeHiresExits(input.employees, range);
  const appraisal = computeAppraisalDistribution(input.appraisalScores);
  const payroll = computePayrollCost(input.payrollRows);
  const recruitment = computeRecruitmentFunnel(input.applications);

  const headlines: BoardHeadline[] = [
    {
      label: "Active headcount",
      value: String(headcount.totalActive),
      source: "Headcount & Org Summary",
    },
    {
      label: "Departments",
      value: String(headcount.departmentCount),
      source: "Headcount & Org Summary",
    },
    {
      label: "Headcount movement",
      value: `${hiresExits.netChange >= 0 ? "+" : ""}${hiresExits.netChange}`,
      source: "New Hires & Exits",
    },
    { label: "New hires", value: String(hiresExits.hireCount), source: "New Hires & Exits" },
    { label: "Exits", value: String(hiresExits.exitCount), source: "New Hires & Exits" },
    {
      label: "Attrition (period)",
      value: num(hiresExits.attritionPct, "%"),
      source: "New Hires & Exits",
    },
    {
      label: "Avg appraisal score",
      value: num(appraisal.average),
      source: "Appraisal Score Distribution",
    },
    {
      label: "Scores published",
      value: String(appraisal.scoredCount),
      source: "Appraisal Score Distribution",
    },
    {
      label: "Payroll cost to company",
      value: `INR ${payroll.totalCostToCompany}`,
      source: "Payroll Cost Summary (FINALIZED only)",
    },
    {
      label: "Payroll rows finalized",
      value: String(payroll.finalizedRowCount),
      source: "Payroll Cost Summary (FINALIZED only)",
    },
    {
      label: "Applications received",
      value: String(recruitment.totalApplications),
      source: "Recruitment Funnel",
    },
    {
      label: "Candidates hired",
      value: String(recruitment.hiredCount),
      source: "Recruitment Funnel",
    },
    {
      label: "Avg time to hire",
      value: recruitment.avgTimeToHireDays === null ? "—" : `${recruitment.avgTimeToHireDays} days`,
      source: "Recruitment Funnel",
    },
  ];

  return { headlines, headcount, hiresExits, appraisal, payroll, recruitment };
}
