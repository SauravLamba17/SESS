/** Valid "YYYY-MM" period string? */
export function isPeriod(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v.trim());
}

/**
 * The 12 "YYYY-MM" months of an Indian financial year, April→March.
 * `fy` is the standard label, e.g. "2026-27" → 2026-04 … 2027-03.
 * Returns null if the label is malformed or the years aren't consecutive.
 */
export function financialYearMonths(fy: string): string[] | null {
  const m = /^(\d{4})-(\d{2})$/.exec(fy.trim());
  if (!m) return null;
  const start = Number(m[1]);
  // "2026-27" → the second half must be (start + 1) mod 100.
  if (Number(m[2]) !== (start + 1) % 100) return null;
  return Array.from({ length: 12 }, (_, i) => {
    const month = 4 + i; // April is month 4
    const y = month > 12 ? start + 1 : start;
    const mm = month > 12 ? month - 12 : month;
    return `${y}-${String(mm).padStart(2, "0")}`;
  });
}

/** The financial-year label a "YYYY-MM" period falls in. Jan–Mar belong to the
 *  FY that started the previous April. */
export function financialYearOf(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Current month as a "YYYY-MM" period string plus its date bounds. */
export function currentPeriod(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  return {
    period: `${y}-${String(m + 1).padStart(2, "0")}`,
    monthStart: new Date(y, m, 1),
    monthEnd: new Date(y, m + 1, 1), // exclusive
  };
}
