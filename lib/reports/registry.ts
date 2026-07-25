// The report catalogue and the ACCESS TABLE — the single source of truth for
// who may run what.
//
// Deliberately client-safe: no db, no server-only imports. The three reports
// pages import it to decide which cards to render, and the API route imports
// the SAME table to decide whether to serve. One table, so the UI can never
// offer a report the server would refuse, and hiding a card is never mistaken
// for enforcement — app/api/reports/[report]/route.ts checks this on every call.

import type { Role } from "@/lib/auth-types";

export type ReportId =
  | "headcount"
  | "attendance"
  | "hires-exits"
  | "production"
  | "appraisal-distribution"
  | "payroll-cost"
  | "recruitment-funnel"
  | "idle-time"
  | "warning-letters"
  | "board-summary"
  | "my-data";

/**
 * What a role may see:
 *   "org"        — every employee in the organisation
 *   "team"       — the manager's own DIRECT reports (lib/data/scope.ts rule)
 *   "department" — the manager's own department (Phase 8 recruitment rule)
 *   "self"       — ONLY the caller's own employee record, resolved from their
 *                  session; no id is ever read from the request
 *   "none"       — no access; the API returns 403
 */
export type ScopeMode = "org" | "team" | "department" | "self" | "none";

export interface ReportDef {
  id: ReportId;
  title: string;
  description: string;
  /** Per-role scope, now stated for EVERY role including EMPLOYEE rather than
   *  relying on an implicit rule — the ten org reports say "none" for EMPLOYEE
   *  in the table itself, so the denial is visible where it is decided. */
  access: Record<Role, ScopeMode>;
  /** Self-service reports are excluded from the Manager/HR/Admin reports pages
   *  — they have their own portal page and are about the viewer, not the org. */
  selfService?: boolean;
  /** Reports offering a CSV alternative to the PDF. Board Summary and My Data
   *  are PDF-only: one is a narrative page, the other a personal manifest. */
  csv?: boolean;
}

export const REPORTS: ReportDef[] = [
  {
    id: "headcount",
    title: "Headcount & Org Summary",
    description:
      "Active headcount, department breakdown, and the movement between the start and end of the period.",
    access: { EMPLOYEE: "none", MANAGER: "team", HR: "org", SUPER_ADMIN: "org" },
    csv: true,
  },
  {
    id: "attendance",
    title: "Attendance & Punctuality",
    description:
      "On-time vs late split, days with no punch, and average punch-in time per employee and department.",
    access: { EMPLOYEE: "none", MANAGER: "team", HR: "org", SUPER_ADMIN: "org" },
    csv: true,
  },
  {
    id: "hires-exits",
    title: "New Hires & Exits",
    description:
      "Who joined and who left in the period, by department, with the attrition rate.",
    access: { EMPLOYEE: "none", MANAGER: "none", HR: "org", SUPER_ADMIN: "org" },
    csv: true,
  },
  {
    id: "production",
    title: "Production vs Target",
    description:
      "Units produced against target, per employee and rolled up by department.",
    access: { EMPLOYEE: "none", MANAGER: "team", HR: "org", SUPER_ADMIN: "org" },
    csv: true,
  },
  {
    id: "appraisal-distribution",
    title: "Appraisal Score Distribution",
    description:
      "Published appraisal scores bucketed into bands, with averages by department and cycle.",
    access: { EMPLOYEE: "none", MANAGER: "team", HR: "org", SUPER_ADMIN: "org" },
    csv: true,
  },
  {
    id: "payroll-cost",
    title: "Payroll Cost Summary",
    description:
      "Total payroll cost broken down by component, month and department. Finalized runs only.",
    access: { EMPLOYEE: "none", MANAGER: "none", HR: "org", SUPER_ADMIN: "org" },
    csv: true,
  },
  {
    id: "recruitment-funnel",
    title: "Recruitment Funnel",
    description:
      "Applications reaching each pipeline stage, conversion rates, and average time to hire.",
    access: { EMPLOYEE: "none", MANAGER: "department", HR: "org", SUPER_ADMIN: "org" },
    csv: true,
  },
  {
    id: "idle-time",
    title: "Idle Time Summary",
    description:
      "Active-vs-idle totals for the period by employee and department. Aggregates only, never a timeline.",
    access: { EMPLOYEE: "none", MANAGER: "team", HR: "org", SUPER_ADMIN: "org" },
    csv: true,
  },
  {
    id: "warning-letters",
    title: "Warning Letters & Disciplinary Trend",
    description:
      "Released warning letters by department with a monthly trend and repeat cases.",
    access: { EMPLOYEE: "none", MANAGER: "none", HR: "org", SUPER_ADMIN: "org" },
    csv: true,
  },
  {
    id: "board-summary",
    title: "Monthly / Quarterly Board Summary",
    description:
      "One page of headline figures, each read directly from its detailed report.",
    access: { EMPLOYEE: "none", MANAGER: "none", HR: "org", SUPER_ADMIN: "org" },
  },
  {
    id: "my-data",
    title: "My Data Export",
    description:
      "Everything SESS holds about you: profile, attendance, leave, production, quality, published appraisals, released warnings, consents and expense claims.",
    // "self" for EVERY role — this is about the viewer, never about anyone
    // else, so there is no role for which it means something wider.
    access: { EMPLOYEE: "self", MANAGER: "self", HR: "self", SUPER_ADMIN: "self" },
    selfService: true,
  },
];

export const REPORT_BY_ID = new Map<string, ReportDef>(REPORTS.map((r) => [r.id, r]));

/** The scope this role gets for this report. A signed-out caller gets nothing. */
export function scopeFor(report: ReportDef, role: Role | null): ScopeMode {
  if (!role) return "none";
  return report.access[role];
}

/**
 * The ORG reports a role may run — what each portal's reports page renders.
 * Self-service reports are excluded: they live on their own portal page.
 */
export function reportsForRole(role: Role | null): ReportDef[] {
  return REPORTS.filter((r) => !r.selfService && scopeFor(r, role) !== "none");
}

/** True when this role may export this report as CSV as well as PDF. */
export function canCsv(report: ReportDef, role: Role | null): boolean {
  return Boolean(report.csv) && scopeFor(report, role) !== "none";
}
