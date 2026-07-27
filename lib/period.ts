/** Valid "YYYY-MM" period string? */
export function isPeriod(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v.trim());
}

/**
 * Strict "YYYY-MM-DD" → local-midnight Date, or null.
 *
 * THE ROLLOVER CHECK IS THE WHOLE POINT. `new Date(2026, 1, 30)` does not
 * throw and is not NaN — it silently becomes 2 March 2026. So a validator
 * written as
 *
 *     const dt = new Date(y, m - 1, d);
 *     return Number.isNaN(dt.getTime()) ? null : dt;
 *
 * accepts "2026-02-30" and hands back the wrong day. That shape was copied
 * into eight separate files in this codebase; reading the fields back off the
 * constructed Date is what actually rejects it.
 *
 * Local midnight, never UTC — the same local-date rule the attendance and
 * payroll code depends on, so a date never shifts by a day for IST users.
 *
 * Lives in lib/period.ts because this file is client-safe: it imports nothing
 * and must never import a server-only module, so form components can validate
 * with the exact function the route will re-validate with.
 */
export function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

/**
 * Strict "YYYY-MM-DD" shape AND calendar check, for the call sites that keep
 * the string rather than the Date. Same validation as parseDateOnly(), so a
 * regex-only `.test()` can be swapped for this without letting 2026-02-30 in.
 */
export function isDateOnly(value: unknown): value is string {
  return parseDateOnly(value) !== null;
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
