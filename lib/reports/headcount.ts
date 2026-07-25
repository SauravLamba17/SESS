// REPORT 1 — Headcount & Org Summary.
//
// INPUT:  every employee in scope (active AND offboarded — an offboarded row is
//         what makes a start-of-range headcount possible), plus the range.
// OUTPUT: current headcount, per-department breakdown, and headcount at the
//         range's start vs end with the net movement between them.
//
// Pure. No DB access.

import type { DateRange } from "./range.ts";
import type { ReportEmployee } from "./types.ts";
import { byCountDesc } from "./types.ts";

/**
 * Was this employee on the payroll on `date`?
 *
 * Joined on or before the date, and not yet past their last working day.
 *
 * THE BOUNDARY, and why it is `<` and not `<=`: Employee.offboardedAt is the
 * LAST WORKING DAY, not the first day of absence — the schema says so, and
 * payroll relies on it (someone who left on the 12th is paid for 12 days). So
 * an employee IS counted on their offboarding date and excluded only from the
 * day after. Getting this backwards would make headcount disagree with the
 * payslip for exactly one day per leaver.
 *
 * Exported because hires-exits.ts and board-summary.ts need exactly this rule
 * for attrition denominators — a second copy of it is how two reports start
 * disagreeing about headcount.
 */
export function activeOn(e: ReportEmployee, date: Date): boolean {
  if (e.joiningDate > date) return false;
  if (e.offboardedAt && e.offboardedAt < date) return false;
  return true;
}

export function headcountOn(employees: ReportEmployee[], date: Date): number {
  return employees.reduce((n, e) => n + (activeOn(e, date) ? 1 : 0), 0);
}

export interface HeadcountResult {
  /** Currently-active employees (the `active` flag, not a date calculation). */
  totalActive: number;
  byDepartment: { department: string; count: number }[];
  departmentCount: number;
  atRangeStart: number;
  atRangeEnd: number;
  /** atRangeEnd − atRangeStart. Negative means the org shrank over the range. */
  netChange: number;
  /** Largest department by headcount, or null when there are no employees. */
  largestDepartment: { department: string; count: number } | null;
}

export function computeHeadcount(
  employees: ReportEmployee[],
  range: DateRange,
): HeadcountResult {
  const active = employees.filter((e) => e.active);

  const counts = new Map<string, number>();
  for (const e of active) counts.set(e.department, (counts.get(e.department) ?? 0) + 1);
  const byDepartment = byCountDesc(
    Array.from(counts.entries()).map(([department, count]) => ({ department, count })),
  );

  const atRangeStart = headcountOn(employees, range.start);
  const atRangeEnd = headcountOn(employees, range.end);

  return {
    totalActive: active.length,
    byDepartment,
    departmentCount: byDepartment.length,
    atRangeStart,
    atRangeEnd,
    netChange: atRangeEnd - atRangeStart,
    largestDepartment: byDepartment[0] ?? null,
  };
}
