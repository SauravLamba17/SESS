// REPORT 8 — Idle Time Summary.
//
// INPUT:  IdleLog rows in range (employeeId, idleMinutes, activeMinutes) and the
//         employees in scope.
// OUTPUT: active-vs-idle ratio for the org, per department and per employee —
//         TOTALS ONLY.
//
// ─── SCOPE CONSTRAINT, carried forward from lib/idle/consent.ts ───────────
// This report emits AGGREGATES over the whole range and nothing else. There is
// deliberately no per-day series, no timeline, no "most idle hour", and no
// productivity score — the same constraint the ingestion side is built around.
// A report is exactly where that constraint would quietly get broken, so it is
// restated here: totals per employee over the period, and nothing finer.
// ─────────────────────────────────────────────────────────────────────────
//
// Pure. No DB access.

import type { ReportEmployee } from "./types.ts";
import { pct } from "./types.ts";

export interface IdleRow {
  employeeId: string;
  idleMinutes: number;
  activeMinutes: number;
}

export interface IdleEmployeeRow {
  employeeId: string;
  name: string;
  employeeCode: string;
  department: string;
  /** Days that reported any data at all — NOT which days. */
  daysWithData: number;
  idleMinutes: number;
  activeMinutes: number;
  totalMinutes: number;
  activePct: number | null;
}

export interface IdleDepartmentRow {
  department: string;
  employeesTracked: number;
  idleMinutes: number;
  activeMinutes: number;
  totalMinutes: number;
  activePct: number | null;
}

export interface IdleTimeResult {
  totalIdleMinutes: number;
  totalActiveMinutes: number;
  totalMinutes: number;
  activePct: number | null;
  /** How many of the in-scope employees reported ANY data — the rest have no
   *  agent, no consent, or simply never ran it. Reported so a low org average
   *  is never mistaken for "everyone is idle". */
  employeesWithData: number;
  employeesInScope: number;
  byEmployee: IdleEmployeeRow[];
  byDepartment: IdleDepartmentRow[];
}

/** "6h 30m" from minutes — same formatting as lib/idle/aggregate.ts's hm(). */
export function hm(minutes: number): string {
  if (minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function computeIdleTime(
  rows: IdleRow[],
  employees: ReportEmployee[],
): IdleTimeResult {
  const perEmp = new Map<string, { days: number; idle: number; active: number }>();
  for (const e of employees) perEmp.set(e.id, { days: 0, idle: 0, active: 0 });

  for (const r of rows) {
    const b = perEmp.get(r.employeeId);
    if (!b) continue;
    b.days++;
    b.idle += r.idleMinutes;
    b.active += r.activeMinutes;
  }

  const byEmployee: IdleEmployeeRow[] = employees
    .map((e) => {
      const b = perEmp.get(e.id)!;
      const total = b.idle + b.active;
      return {
        employeeId: e.id,
        name: e.name,
        employeeCode: e.employeeCode,
        department: e.department,
        daysWithData: b.days,
        idleMinutes: b.idle,
        activeMinutes: b.active,
        totalMinutes: total,
        activePct: pct(b.active, total),
      };
    })
    .sort((a, b) => b.totalMinutes - a.totalMinutes || a.employeeCode.localeCompare(b.employeeCode));

  const perDept = new Map<
    string,
    { tracked: Set<string>; idle: number; active: number }
  >();
  for (const row of byEmployee) {
    const d = perDept.get(row.department) ?? { tracked: new Set<string>(), idle: 0, active: 0 };
    if (row.totalMinutes > 0) d.tracked.add(row.employeeId);
    d.idle += row.idleMinutes;
    d.active += row.activeMinutes;
    perDept.set(row.department, d);
  }
  const byDepartment: IdleDepartmentRow[] = Array.from(perDept.entries())
    .map(([department, d]) => {
      const total = d.idle + d.active;
      return {
        department,
        employeesTracked: d.tracked.size,
        idleMinutes: d.idle,
        activeMinutes: d.active,
        totalMinutes: total,
        activePct: pct(d.active, total),
      };
    })
    .sort((a, b) => b.totalMinutes - a.totalMinutes || a.department.localeCompare(b.department));

  const totalIdle = byEmployee.reduce((n, r) => n + r.idleMinutes, 0);
  const totalActive = byEmployee.reduce((n, r) => n + r.activeMinutes, 0);

  return {
    totalIdleMinutes: totalIdle,
    totalActiveMinutes: totalActive,
    totalMinutes: totalIdle + totalActive,
    activePct: pct(totalActive, totalIdle + totalActive),
    employeesWithData: byEmployee.filter((r) => r.totalMinutes > 0).length,
    employeesInScope: employees.length,
    byEmployee,
    byDepartment,
  };
}
