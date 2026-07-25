// REPORT 3 — New Hires & Exits.
//
// INPUT:  every employee in scope (active and offboarded) plus the range.
// OUTPUT: who joined and who left within the range, per-department, the net
//         movement, and the attrition rate over the period.
//
// Pure. No DB access. Reuses headcountOn() from headcount.ts for the attrition
// denominator rather than re-deriving "was employed on this date".

import type { DateRange } from "./range.ts";
import { monthKey, monthsInRange } from "./range.ts";
import type { ReportEmployee } from "./types.ts";
import { headcountOn } from "./headcount.ts";
import { pct } from "./types.ts";

export interface MovementRow {
  employeeId: string;
  name: string;
  employeeCode: string;
  department: string;
  date: Date;
}

export interface HiresExitsResult {
  hireCount: number;
  exitCount: number;
  netChange: number;
  hires: MovementRow[];
  exits: MovementRow[];
  byDepartment: { department: string; hires: number; exits: number; net: number }[];
  /** Month-by-month movement when the range spans more than one month. */
  byMonth: { month: string; hires: number; exits: number }[];
  /** exits ÷ average headcount over the range, as a percentage. Null when the
   *  org was empty for the whole range (no meaningful denominator). */
  attritionPct: number | null;
  avgHeadcount: number;
}

function inRange(d: Date, range: DateRange): boolean {
  return d >= range.start && d < range.endExclusive;
}

export function computeHiresExits(
  employees: ReportEmployee[],
  range: DateRange,
): HiresExitsResult {
  const toRow = (e: ReportEmployee, date: Date): MovementRow => ({
    employeeId: e.id,
    name: e.name,
    employeeCode: e.employeeCode,
    department: e.department,
    date,
  });

  const hires = employees
    .filter((e) => inRange(e.joiningDate, range))
    .map((e) => toRow(e, e.joiningDate))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const exits = employees
    .filter((e) => e.offboardedAt && inRange(e.offboardedAt, range))
    .map((e) => toRow(e, e.offboardedAt!))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const deptMap = new Map<string, { hires: number; exits: number }>();
  for (const h of hires) {
    const d = deptMap.get(h.department) ?? { hires: 0, exits: 0 };
    d.hires++;
    deptMap.set(h.department, d);
  }
  for (const x of exits) {
    const d = deptMap.get(x.department) ?? { hires: 0, exits: 0 };
    d.exits++;
    deptMap.set(x.department, d);
  }
  const byDepartment = Array.from(deptMap.entries())
    .map(([department, d]) => ({ ...d, department, net: d.hires - d.exits }))
    .sort(
      (a, b) =>
        b.hires + b.exits - (a.hires + a.exits) || a.department.localeCompare(b.department),
    );

  const monthBuckets = new Map<string, { hires: number; exits: number }>();
  for (const m of monthsInRange(range)) monthBuckets.set(m, { hires: 0, exits: 0 });
  for (const h of hires) {
    const b = monthBuckets.get(monthKey(h.date));
    if (b) b.hires++;
  }
  for (const x of exits) {
    const b = monthBuckets.get(monthKey(x.date));
    if (b) b.exits++;
  }
  const byMonth = Array.from(monthBuckets.entries()).map(([month, b]) => ({ month, ...b }));

  // Average headcount = mean of the range's endpoints. Deliberately simple:
  // a daily-integral average would be more precise and no more useful at this
  // reporting granularity.
  const startHead = headcountOn(employees, range.start);
  const endHead = headcountOn(employees, range.end);
  const avgHeadcount = (startHead + endHead) / 2;

  return {
    hireCount: hires.length,
    exitCount: exits.length,
    netChange: hires.length - exits.length,
    hires,
    exits,
    byDepartment,
    byMonth,
    attritionPct: avgHeadcount > 0 ? pct(exits.length, avgHeadcount) : null,
    avgHeadcount,
  };
}
