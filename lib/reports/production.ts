// REPORT 4 — Production vs Target.
//
// INPUT:  Production rows in range (employeeId, unitsProduced), the employees in
//         scope, and each employee's MonthlyTarget summed over the range's months
//         — or null when the range is not whole calendar months.
// OUTPUT: actual vs target per employee and per department, with achievement
//         percentages and the org total.
//
// Target comes from MonthlyTarget, the figure the manager sets on Production &
// Targets and the same one the employee dashboard and appraisal compute use.
// (Production.targetUnits is a legacy column that has been 0 since Phase 2.)
//
// Whole-month rule, as for appraisal cycles: a monthly target is only compared
// when the range is exactly one or more whole calendar months. For any other
// range the target is null — shown as "N/A" — rather than a pro-rated guess.
//
// Pure. No DB access.

import type { ReportEmployee } from "./types.ts";
import { pct } from "./types.ts";

export interface ProductionRow {
  employeeId: string;
  unitsProduced: number;
}

export interface ProductionTarget {
  employeeId: string;
  targetUnits: number;
}

export interface ProductionEmployeeRow {
  employeeId: string;
  name: string;
  employeeCode: string;
  department: string;
  days: number;
  actual: number;
  /** Sum of the employee's monthly targets; 0 = no target set; null = N/A (partial-month range). */
  target: number | null;
  /** actual ÷ target × 100. Null when there is no target (never a fake 0%). */
  achievementPct: number | null;
  /** actual − target; null when the target is N/A. */
  variance: number | null;
}

export interface ProductionDepartmentRow {
  department: string;
  employees: number;
  actual: number;
  target: number | null;
  achievementPct: number | null;
  variance: number | null;
}

export interface ProductionResult {
  /** False when the range is not whole calendar months, so targets are N/A. */
  targetsApply: boolean;
  totalActual: number;
  totalTarget: number | null;
  achievementPct: number | null;
  variance: number | null;
  /** Employees who met or beat their target. */
  metTargetCount: number;
  belowTargetCount: number;
  byEmployee: ProductionEmployeeRow[];
  byDepartment: ProductionDepartmentRow[];
}

export const PRODUCTION_TARGET_NA_NOTE =
  "Targets are monthly, so they are shown only when the period is whole calendar months. For this period they are N/A.";

export function computeProduction(
  rows: ProductionRow[],
  employees: ReportEmployee[],
  targets: ProductionTarget[] | null,
): ProductionResult {
  const targetsApply = targets !== null;
  const targetBy = new Map<string, number>();
  for (const t of targets ?? []) targetBy.set(t.employeeId, (targetBy.get(t.employeeId) ?? 0) + t.targetUnits);

  const perEmp = new Map<string, { days: number; actual: number }>();
  for (const e of employees) perEmp.set(e.id, { days: 0, actual: 0 });
  for (const r of rows) {
    const b = perEmp.get(r.employeeId);
    if (!b) continue;
    b.days++;
    b.actual += r.unitsProduced;
  }

  const ratio = (actual: number, target: number | null) =>
    target !== null && target > 0 ? pct(actual, target) : null;

  const byEmployee: ProductionEmployeeRow[] = employees
    .map((e) => {
      const b = perEmp.get(e.id)!;
      const target = targetsApply ? targetBy.get(e.id) ?? 0 : null;
      return {
        employeeId: e.id,
        name: e.name,
        employeeCode: e.employeeCode,
        department: e.department,
        days: b.days,
        actual: b.actual,
        target,
        achievementPct: ratio(b.actual, target),
        variance: target === null ? null : b.actual - target,
      };
    })
    .sort((a, b) => b.actual - a.actual || a.employeeCode.localeCompare(b.employeeCode));

  const perDept = new Map<string, { employees: number; actual: number; target: number }>();
  for (const row of byEmployee) {
    const d = perDept.get(row.department) ?? { employees: 0, actual: 0, target: 0 };
    d.employees++;
    d.actual += row.actual;
    d.target += row.target ?? 0;
    perDept.set(row.department, d);
  }
  const byDepartment: ProductionDepartmentRow[] = Array.from(perDept.entries())
    .map(([department, d]) => {
      const target = targetsApply ? d.target : null;
      return {
        department,
        employees: d.employees,
        actual: d.actual,
        target,
        achievementPct: ratio(d.actual, target),
        variance: target === null ? null : d.actual - target,
      };
    })
    .sort((a, b) => b.actual - a.actual || a.department.localeCompare(b.department));

  const totalActual = byEmployee.reduce((n, r) => n + r.actual, 0);
  const totalTarget = targetsApply ? byEmployee.reduce((n, r) => n + (r.target ?? 0), 0) : null;

  // Only employees who actually have a target count towards met/below.
  const withTarget = byEmployee.filter((r) => r.target !== null && r.target > 0);

  return {
    targetsApply,
    totalActual,
    totalTarget,
    achievementPct: ratio(totalActual, totalTarget),
    variance: totalTarget === null ? null : totalActual - totalTarget,
    metTargetCount: withTarget.filter((r) => r.actual >= r.target!).length,
    belowTargetCount: withTarget.filter((r) => r.actual < r.target!).length,
    byEmployee,
    byDepartment,
  };
}
