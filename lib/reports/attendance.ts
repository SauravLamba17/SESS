// REPORT 2 — Attendance & Punctuality.
//
// INPUT:  attendance rows in range (employeeId, checkIn, lateFlag, lateMinutes),
//         the employees in scope, and the range.
// OUTPUT: late/on-time split, days with no punch, and the AVERAGE PUNCH-IN TIME
//         per employee and per department.
//
// Pure. No DB access.

import type { DateRange } from "./range.ts";
import { weekdaysInRange } from "./range.ts";
import type { ReportEmployee } from "./types.ts";
import { pct } from "./types.ts";

export interface AttendanceRow {
  employeeId: string;
  /** Null when the row exists but nobody ever punched in (should not happen —
   *  handled rather than assumed away). */
  checkIn: Date | null;
  lateFlag: boolean;
  lateMinutes: number | null;
}

// ── Average punch-in time ──────────────────────────────────────────────────
//
// Clock times cannot be averaged as strings or as Date objects (their calendar
// dates differ). The method here, in three steps:
//
//   1. Each check-in becomes MINUTES SINCE LOCAL MIDNIGHT:
//        minutes = getHours() * 60 + getMinutes()
//   2. Those integers are averaged arithmetically and rounded to the nearest
//      whole minute.
//   3. The mean converts back to a display clock time:
//        HH = floor(mean / 60), MM = mean % 60
//
// Worked example (also asserted in prisma/verify-phase12.ts):
//   09:15 → 9*60+15 = 555
//   09:45 → 9*60+45 = 585
//   10:00 → 10*60+0 = 600
//   mean  = (555 + 585 + 600) / 3 = 1740 / 3 = 580
//   580   → 580/60 = 9 remainder 40 → "09:40"
//
// THE MIDNIGHT PROBLEM, and why there are now two means.
//
// The linear mean above is correct only when a group's punches all sit on one
// side of midnight — true for the 09:00–17:00 day shift, false for the
// 18:00–03:00 night shift. Two night punches at 23:00 (1380) and 01:00 (60)
// average linearly to 720 = 12:00, which is not merely imprecise but the
// opposite time of day, twelve hours from the true answer of ~00:00.
//
// So the mean is chosen per group by the SHIFT: an employee whose shift
// crosses midnight gets a circular mean, everyone else keeps the linear one.
// The day shift's arithmetic is therefore completely unchanged.

/** Minutes since local midnight for a check-in timestamp. */
export function minutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Minutes since midnight → "HH:MM". Wraps, so 1440 reads as 00:00. */
export function minutesToClock(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const MINUTES_PER_DAY = 1440;

/** Plain arithmetic mean. Correct for any group that does not cross midnight. */
export function linearMeanMinutes(checkIns: Date[]): number | null {
  if (checkIns.length === 0) return null;
  const sum = checkIns.reduce((t, d) => t + minutesSinceMidnight(d), 0);
  return Math.round(sum / checkIns.length);
}

/**
 * CIRCULAR MEAN — the correct average for times that straddle midnight.
 *
 * Each time becomes an angle on a 24-hour circle (minutes / 1440 × 2π). The
 * sine and cosine components are averaged separately, and atan2 turns the
 * resulting vector back into a time of day. Because it averages directions
 * rather than numbers, 23:00 and 01:00 average to 00:00 — they are two hours
 * apart on the circle, not twenty-two.
 *
 * Returns null when the punches are so evenly spread around the clock that
 * the resultant vector has no direction (e.g. exactly 06:00 and 18:00). That
 * is a genuine "no meaningful average" rather than a number to invent, and
 * callers already render null as "—".
 */
export function circularMeanMinutes(checkIns: Date[]): number | null {
  if (checkIns.length === 0) return null;

  let sinSum = 0;
  let cosSum = 0;
  for (const d of checkIns) {
    const angle = (minutesSinceMidnight(d) / MINUTES_PER_DAY) * 2 * Math.PI;
    sinSum += Math.sin(angle);
    cosSum += Math.cos(angle);
  }
  const n = checkIns.length;
  const sinMean = sinSum / n;
  const cosMean = cosSum / n;

  // Resultant length: 0 means the times cancel out and no mean direction exists.
  if (Math.sqrt(sinMean * sinMean + cosMean * cosMean) < 1e-9) return null;

  let angle = Math.atan2(sinMean, cosMean);
  if (angle < 0) angle += 2 * Math.PI; // atan2 gives (-π, π]; we want [0, 2π)

  const minutes = Math.round((angle / (2 * Math.PI)) * MINUTES_PER_DAY);
  return minutes % MINUTES_PER_DAY; // a mean landing on 1440 is 00:00
}

/**
 * The average check-in time for a group.
 *
 * `crossesMidnight` comes from the employees' assigned Shift — when true the
 * circular mean is used, otherwise the linear one. Defaults to false so every
 * existing caller keeps the original day-shift behaviour.
 */
export function averagePunchInMinutes(
  checkIns: Date[],
  crossesMidnight = false,
): number | null {
  return crossesMidnight ? circularMeanMinutes(checkIns) : linearMeanMinutes(checkIns);
}

export interface AttendanceEmployeeRow {
  employeeId: string;
  name: string;
  employeeCode: string;
  department: string;
  punchDays: number;
  lateCount: number;
  onTimeCount: number;
  latePct: number | null;
  /** Mean minutes past the cutoff across ONLY the late days. */
  avgLateMinutes: number | null;
  avgPunchInMinutes: number | null;
  avgPunchIn: string | null; // "HH:MM"
  /** Which mean produced avgPunchIn — printed so a night-shift figure is
   *  never mistaken for a linear average. */
  avgPunchInMethod: "linear" | "circular";
}

export interface AttendanceDepartmentRow {
  department: string;
  employees: number;
  punchDays: number;
  lateCount: number;
  latePct: number | null;
  /** Punch-weighted: every punch in the department counts once, so a person
   *  who worked more days contributes proportionally more. */
  avgPunchInMinutes: number | null;
  avgPunchIn: string | null;
  avgPunchInMethod: "linear" | "circular";
}

export interface AttendanceResult {
  totalPunchDays: number;
  lateCount: number;
  onTimeCount: number;
  latePct: number | null;
  onTimePct: number | null;
  orgAvgPunchInMinutes: number | null;
  orgAvgPunchIn: string | null;
  orgAvgPunchInMethod: "linear" | "circular";
  /** True when any employee in scope works a midnight-crossing shift. */
  hasOvernightShift: boolean;
  /** Weekdays in range × employees in scope, minus days actually punched.
   *  A blunt proxy for absence: this system has no per-day expected-attendance
   *  model, so approved leave and holidays are counted here too. Labelled as
   *  "no punch recorded", never as "absent without leave". */
  expectedWeekdayCount: number;
  noPunchDays: number;
  byEmployee: AttendanceEmployeeRow[];
  byDepartment: AttendanceDepartmentRow[];
}

export function computeAttendance(
  rows: AttendanceRow[],
  employees: ReportEmployee[],
  range: DateRange,
): AttendanceResult {
  const empById = new Map(employees.map((e) => [e.id, e]));

  // One pass, bucketed per employee. No nested scans over `rows`.
  const perEmp = new Map<
    string,
    { punchDays: number; late: number; lateMinutes: number; checkIns: Date[] }
  >();
  for (const e of employees)
    perEmp.set(e.id, { punchDays: 0, late: 0, lateMinutes: 0, checkIns: [] });

  for (const r of rows) {
    const bucket = perEmp.get(r.employeeId);
    if (!bucket) continue; // outside scope — ignore rather than trust the input
    bucket.punchDays++;
    if (r.lateFlag) {
      bucket.late++;
      bucket.lateMinutes += r.lateMinutes ?? 0;
    }
    if (r.checkIn) bucket.checkIns.push(r.checkIn);
  }

  const byEmployee: AttendanceEmployeeRow[] = [];
  for (const e of employees) {
    const b = perEmp.get(e.id)!;
    // Circular mean ONLY for employees on a midnight-crossing shift.
    const circular = e.shiftCrossesMidnight === true;
    const avgMins = averagePunchInMinutes(b.checkIns, circular);
    byEmployee.push({
      employeeId: e.id,
      name: e.name,
      employeeCode: e.employeeCode,
      department: e.department,
      punchDays: b.punchDays,
      lateCount: b.late,
      onTimeCount: b.punchDays - b.late,
      latePct: pct(b.late, b.punchDays),
      avgLateMinutes: b.late > 0 ? Math.round(b.lateMinutes / b.late) : null,
      avgPunchInMinutes: avgMins,
      avgPunchIn: avgMins === null ? null : minutesToClock(avgMins),
      avgPunchInMethod: circular ? "circular" : "linear",
    });
  }
  byEmployee.sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));

  // Department roll-up: re-average over the department's raw punches, NOT an
  // average of per-employee averages (which would weight a one-day employee
  // the same as a twenty-day one).
  // Department roll-up keeps the raw check-in TIMES, not a running total, so
  // either mean can be applied to them. Still punch-weighted: every punch in
  // the department counts once.
  const perDept = new Map<
    string,
    {
      employees: number;
      punchDays: number;
      late: number;
      checkIns: Date[];
      crossesMidnight: boolean;
    }
  >();
  for (const e of employees) {
    const d = perDept.get(e.department) ?? {
      employees: 0,
      punchDays: 0,
      late: 0,
      checkIns: [],
      crossesMidnight: false,
    };
    d.employees++;
    // A department containing ANY night-shift staff is averaged circularly —
    // a linear mean over punches that straddle midnight is wrong for the whole
    // group, not just for the night workers in it.
    if (e.shiftCrossesMidnight === true) d.crossesMidnight = true;
    perDept.set(e.department, d);
  }
  for (const r of rows) {
    const emp = empById.get(r.employeeId);
    if (!emp) continue;
    const d = perDept.get(emp.department)!;
    d.punchDays++;
    if (r.lateFlag) d.late++;
    if (r.checkIn) d.checkIns.push(r.checkIn);
  }

  const byDepartment: AttendanceDepartmentRow[] = Array.from(perDept.entries())
    .map(([department, d]) => {
      const avg = averagePunchInMinutes(d.checkIns, d.crossesMidnight);
      return {
        department,
        employees: d.employees,
        punchDays: d.punchDays,
        lateCount: d.late,
        latePct: pct(d.late, d.punchDays),
        avgPunchInMinutes: avg,
        avgPunchIn: avg === null ? null : minutesToClock(avg),
        avgPunchInMethod: d.crossesMidnight ? ("circular" as const) : ("linear" as const),
      };
    })
    .sort((a, b) => b.punchDays - a.punchDays || a.department.localeCompare(b.department));

  const allCheckIns = rows.filter((r) => r.checkIn && empById.has(r.employeeId)).map((r) => r.checkIn!);
  const hasOvernightShift = employees.some((e) => e.shiftCrossesMidnight === true);
  const orgAvg = averagePunchInMinutes(allCheckIns, hasOvernightShift);

  const totalPunchDays = byEmployee.reduce((n, r) => n + r.punchDays, 0);
  const lateCount = byEmployee.reduce((n, r) => n + r.lateCount, 0);
  const expectedWeekdayCount = weekdaysInRange(range) * employees.length;

  return {
    totalPunchDays,
    lateCount,
    onTimeCount: totalPunchDays - lateCount,
    latePct: pct(lateCount, totalPunchDays),
    onTimePct: pct(totalPunchDays - lateCount, totalPunchDays),
    orgAvgPunchInMinutes: orgAvg,
    orgAvgPunchIn: orgAvg === null ? null : minutesToClock(orgAvg),
    orgAvgPunchInMethod: hasOvernightShift ? "circular" : "linear",
    hasOvernightShift,
    expectedWeekdayCount,
    noPunchDays: Math.max(0, expectedWeekdayCount - totalPunchDays),
    byEmployee,
    byDepartment,
  };
}
