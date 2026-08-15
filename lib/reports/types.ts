/**
 * Shared input shapes for the report aggregation functions.
 *
 * Every one of these is PLAIN DATA — the API route batch-fetches and maps into
 * these shapes, then the pure function does the arithmetic. Same separation as
 * lib/appraisal/compute.ts (EmployeeMetrics) and lib/payroll/compute.ts
 * (PayComponents): no Prisma types leak in, so every function is callable from
 * a test script with hand-written rows.
 */

/** The employee fields the reports actually read. Shared by five of them. */
export interface ReportEmployee {
  id: string;
  name: string;
  employeeCode: string;
  department: string;
  active: boolean;
  joiningDate: Date;
  offboardedAt: Date | null;
  /**
   * True when the employee's assigned shift runs past midnight (the company's
   * 18:00–03:00 night shift). Only the attendance report reads it, to pick a
   * circular mean over a linear one for their punch-in times. Optional and
   * defaulting to false, so the day shift and every other report are unaffected.
   */
  shiftCrossesMidnight?: boolean;
}

/**
 * Sort helper for a by-department section: count descending, department name
 * as the tie-break so equal counts are still stably ordered.
 *
 * Only lib/reports/headcount.ts uses it. The other by-department sections
 * (attendance.ts, idle-time.ts, production.ts) sort inline because they order
 * by their own domain keys, not by a plain count.
 */
export function byCountDesc<T extends { department: string; count: number }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => b.count - a.count || a.department.localeCompare(b.department),
  );
}

/** Group any rows by a derived key into a Map, preserving insertion order. */
export function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const bucket = out.get(k);
    if (bucket) bucket.push(r);
    else out.set(k, [r]);
  }
  return out;
}

/** Percentage, rounded to one decimal. Returns null when the base is zero —
 *  never a fabricated 0% for "no data". */
export function pct(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}
