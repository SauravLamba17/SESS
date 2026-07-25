// REPORT 4 — Production vs Target.
//
// INPUT:  Production rows in range (employeeId, unitsProduced, targetUnits) and
//         the employees in scope.
// OUTPUT: actual vs target per employee and per department, with achievement
//         percentages and the org total.
//
// Target comes from Production.targetUnits — the target recorded ON each
// production row — not from MonthlyTarget. Over an arbitrary date range that is
// the only target figure that lines up row-for-row with the actuals; a monthly
// target cannot be sliced to a partial month without inventing a daily rate.
//
// Pure. No DB access.

import type { ReportEmployee } from "./types.ts";
import { pct } from "./types.ts";

export interface ProductionRow {
  employeeId: string;
  unitsProduced: number;
  targetUnits: number;
}

export interface ProductionEmployeeRow {
  employeeId: string;
  name: string;
  employeeCode: string;
  department: string;
  days: number;
  actual: number;
  target: number;
  /** actual ÷ target × 100. Null when no target was recorded (never a fake 0%). */
  achievementPct: number | null;
  variance: number; // actual − target
}

export interface ProductionDepartmentRow {
  department: string;
  employees: number;
  actual: number;
  target: number;
  achievementPct: number | null;
  variance: number;
}

export interface ProductionResult {
  totalActual: number;
  totalTarget: number;
  achievementPct: number | null;
  variance: number;
  /** Employees who met or beat their recorded target. */
  metTargetCount: number;
  belowTargetCount: number;
  byEmployee: ProductionEmployeeRow[];
  byDepartment: ProductionDepartmentRow[];
}

export function computeProduction(
  rows: ProductionRow[],
  employees: ReportEmployee[],
): ProductionResult {
  const perEmp = new Map<string, { days: number; actual: number; target: number }>();
  for (const e of employees) perEmp.set(e.id, { days: 0, actual: 0, target: 0 });

  for (const r of rows) {
    const b = perEmp.get(r.employeeId);
    if (!b) continue;
    b.days++;
    b.actual += r.unitsProduced;
    b.target += r.targetUnits;
  }

  const byEmployee: ProductionEmployeeRow[] = employees
    .map((e) => {
      const b = perEmp.get(e.id)!;
      return {
        employeeId: e.id,
        name: e.name,
        employeeCode: e.employeeCode,
        department: e.department,
        days: b.days,
        actual: b.actual,
        target: b.target,
        achievementPct: b.target > 0 ? pct(b.actual, b.target) : null,
        variance: b.actual - b.target,
      };
    })
    .sort((a, b) => b.actual - a.actual || a.employeeCode.localeCompare(b.employeeCode));

  const perDept = new Map<
    string,
    { employees: number; actual: number; target: number }
  >();
  for (const row of byEmployee) {
    const d = perDept.get(row.department) ?? { employees: 0, actual: 0, target: 0 };
    d.employees++;
    d.actual += row.actual;
    d.target += row.target;
    perDept.set(row.department, d);
  }
  const byDepartment: ProductionDepartmentRow[] = Array.from(perDept.entries())
    .map(([department, d]) => ({
      department,
      employees: d.employees,
      actual: d.actual,
      target: d.target,
      achievementPct: d.target > 0 ? pct(d.actual, d.target) : null,
      variance: d.actual - d.target,
    }))
    .sort((a, b) => b.actual - a.actual || a.department.localeCompare(b.department));

  const totalActual = byEmployee.reduce((n, r) => n + r.actual, 0);
  const totalTarget = byEmployee.reduce((n, r) => n + r.target, 0);

  // Only employees who actually have a target count towards met/below — an
  // employee with no production rows is neither.
  const withTarget = byEmployee.filter((r) => r.target > 0);

  return {
    totalActual,
    totalTarget,
    achievementPct: totalTarget > 0 ? pct(totalActual, totalTarget) : null,
    variance: totalActual - totalTarget,
    metTargetCount: withTarget.filter((r) => r.actual >= r.target).length,
    belowTargetCount: withTarget.filter((r) => r.actual < r.target).length,
    byEmployee,
    byDepartment,
  };
}
