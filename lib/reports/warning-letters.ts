// REPORT 9 — Warning Letters & Disciplinary Trend.
//
// INPUT:  WarningLetter rows RELEASED within the range, each with the recipient's
//         department and its releasedAt date.
// OUTPUT: total released, per-department breakdown, month-by-month trend, and
//         the count of employees with more than one in the period.
//
// RELEASED ONLY. A DRAFT warning is a manager's private working note that the
// employee has never seen — counting drafts in a disciplinary trend would report
// intentions as if they were actions. Filtered inside the pure function so the
// rule is testable without a database, same as payroll-cost.ts's FINALIZED rule.
//
// Pure. No DB access.

import type { DateRange } from "./range.ts";
import { monthKey, monthsInRange } from "./range.ts";
import { pct } from "./types.ts";

export type WarningStatusLike = "DRAFT" | "RELEASED";

export interface WarningRow {
  id: string;
  employeeId: string;
  name: string;
  employeeCode: string;
  department: string;
  status: WarningStatusLike;
  releasedAt: Date | null;
}

export interface WarningLettersResult {
  releasedCount: number;
  /** Rows excluded for still being DRAFT, so the filter is visible in the output. */
  excludedDraftCount: number;
  employeesAffected: number;
  /** Employees with 2+ released letters in this range — the escalation signal. */
  repeatEmployees: { employeeId: string; name: string; employeeCode: string; department: string; count: number }[];
  byDepartment: { department: string; count: number; sharePct: number | null }[];
  /** Always present; one row per month the range touches, zeros included, so a
   *  flat trend is visibly flat rather than an empty table. */
  byMonth: { month: string; count: number }[];
  /** True when the range spans more than one month (the trend is meaningful). */
  hasTrend: boolean;
  busiestMonth: { month: string; count: number } | null;
}

export function computeWarningLetters(
  rows: WarningRow[],
  range: DateRange,
): WarningLettersResult {
  const released = rows.filter((r) => r.status === "RELEASED" && r.releasedAt !== null);

  const perEmp = new Map<
    string,
    { name: string; employeeCode: string; department: string; count: number }
  >();
  const perDept = new Map<string, number>();
  for (const r of released) {
    const e = perEmp.get(r.employeeId) ?? {
      name: r.name,
      employeeCode: r.employeeCode,
      department: r.department,
      count: 0,
    };
    e.count++;
    perEmp.set(r.employeeId, e);
    perDept.set(r.department, (perDept.get(r.department) ?? 0) + 1);
  }

  const months = monthsInRange(range);
  const monthCounts = new Map<string, number>(months.map((m) => [m, 0]));
  for (const r of released) {
    const k = monthKey(r.releasedAt!);
    if (monthCounts.has(k)) monthCounts.set(k, monthCounts.get(k)! + 1);
  }
  const byMonth = months.map((month) => ({ month, count: monthCounts.get(month) ?? 0 }));

  const busiest = byMonth.reduce<{ month: string; count: number } | null>(
    (best, m) => (m.count > 0 && (!best || m.count > best.count) ? m : best),
    null,
  );

  return {
    releasedCount: released.length,
    excludedDraftCount: rows.length - released.length,
    employeesAffected: perEmp.size,
    repeatEmployees: Array.from(perEmp.entries())
      .filter(([, e]) => e.count > 1)
      .map(([employeeId, e]) => ({ employeeId, ...e }))
      .sort((a, b) => b.count - a.count || a.employeeCode.localeCompare(b.employeeCode)),
    byDepartment: Array.from(perDept.entries())
      .map(([department, count]) => ({
        department,
        count,
        sharePct: pct(count, released.length),
      }))
      .sort((a, b) => b.count - a.count || a.department.localeCompare(b.department)),
    byMonth,
    hasTrend: months.length > 1,
    busiestMonth: busiest,
  };
}
