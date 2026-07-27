/**
 * Shared date-range parsing for every report.
 *
 * RANGE logic lives here; single-DATE and month arithmetic live in
 * lib/period.ts. That split is deliberate: period.ts's month helpers
 * (currentPeriod, financialYearOf, financialYearMonths) are built around a
 * FIXED "YYYY-MM" because payroll and Form 16 are month-shaped documents,
 * whereas a report covers an arbitrary start/end. Nothing here duplicates
 * period.ts's month arithmetic.
 *
 * The one thing that DID belong in period.ts is parsing a single "YYYY-MM-DD",
 * which this file used to define privately — and which turned out to be
 * copy-pasted into a dozen other files, most of them missing the rollover
 * check. That parser now lives in period.ts and is imported below.
 *
 * Pure — no DB, no I/O. Used by the API route to validate query params before
 * a single row is fetched.
 */
import { parseDateOnly } from "../period.ts";

/** Two years. A report over a longer span is almost certainly a mistyped year,
 *  and an unbounded range is an unbounded query. */
export const MAX_RANGE_DAYS = 731;

export interface DateRange {
  /** Inclusive start, local midnight. */
  start: Date;
  /** INCLUSIVE end as the user means it, local midnight of that day. */
  end: Date;
  /** EXCLUSIVE upper bound (end + 1 day) — what every `date < x` query uses. */
  endExclusive: Date;
  /** "YYYY-MM-DD" forms, for PDF headers and filenames. */
  startLabel: string;
  endLabel: string;
  /** Whole days covered, inclusive of both ends. */
  days: number;
}

export type RangeResult =
  | { ok: true; range: DateRange }
  | { ok: false; code: "BAD_DATE" | "REVERSED" | "TOO_LONG"; message: string };

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** "YYYY-MM" bucket key for the monthly-trend sections of several reports. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Parse and validate a start/end pair. Never throws — every failure is a code
 * the route maps to a 400.
 */
export function parseRange(startRaw: unknown, endRaw: unknown): RangeResult {
  const start = parseDateOnly(startRaw);
  const end = parseDateOnly(endRaw);
  if (!start || !end)
    return {
      ok: false,
      code: "BAD_DATE",
      message: "startDate and endDate must both be valid YYYY-MM-DD dates",
    };

  if (end < start)
    return {
      ok: false,
      code: "REVERSED",
      message: "endDate cannot be before startDate",
    };

  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS)
    return {
      ok: false,
      code: "TOO_LONG",
      message: `A report may cover at most ${MAX_RANGE_DAYS} days (about 2 years); this range is ${days} days.`,
    };

  return {
    ok: true,
    range: {
      start,
      end,
      endExclusive: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1),
      startLabel: ymd(start),
      endLabel: ymd(end),
      days,
    },
  };
}

/** Current calendar month — the default range every reports page opens with. */
export function currentMonthRange(now = new Date()): DateRange {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day
  const parsed = parseRange(ymd(start), ymd(end));
  // Cannot fail: both dates are constructed valid and one month is under the cap.
  if (!parsed.ok) throw new Error("currentMonthRange produced an invalid range");
  return parsed.range;
}

/** Count of Mon–Fri days in the range. The denominator for "days with no punch". */
export function weekdaysInRange(range: DateRange): number {
  let n = 0;
  const cur = new Date(range.start);
  while (cur < range.endExclusive) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

/** Distinct "YYYY-MM" months the range touches, in order. */
export function monthsInRange(range: DateRange): string[] {
  const out: string[] = [];
  const cur = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
  while (cur < range.endExclusive) {
    out.push(monthKey(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}
