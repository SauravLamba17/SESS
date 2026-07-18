// Resolve an appraisal cycle's period string to a concrete date range and the
// set of "YYYY-MM" month keys it spans (for MonthlyTarget lookup).
//
// Supports "YYYY-MM" (one month) and "YYYY-Qn" (a quarter). Returns null for
// anything else — callers reject compute with a clear 400 rather than guessing.

export interface PeriodRange {
  start: Date; // inclusive
  end: Date; // exclusive
  monthPeriods: string[]; // e.g. ["2026-07","2026-08","2026-09"]
}

function monthKey(y: number, m0: number): string {
  return `${y}-${String(m0 + 1).padStart(2, "0")}`;
}

export function resolvePeriodRange(period: string): PeriodRange | null {
  const p = period.trim();

  const month = /^(\d{4})-(\d{2})$/.exec(p);
  if (month) {
    const y = Number(month[1]);
    const m0 = Number(month[2]) - 1;
    if (m0 < 0 || m0 > 11) return null;
    return {
      start: new Date(y, m0, 1),
      end: new Date(y, m0 + 1, 1),
      monthPeriods: [monthKey(y, m0)],
    };
  }

  const quarter = /^(\d{4})-Q([1-4])$/i.exec(p);
  if (quarter) {
    const y = Number(quarter[1]);
    const q = Number(quarter[2]);
    const startM0 = (q - 1) * 3;
    return {
      start: new Date(y, startM0, 1),
      end: new Date(y, startM0 + 3, 1),
      monthPeriods: [monthKey(y, startM0), monthKey(y, startM0 + 1), monthKey(y, startM0 + 2)],
    };
  }

  return null;
}
