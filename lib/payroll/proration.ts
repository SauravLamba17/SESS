// Pure salary pro-ration. No DB access, no I/O.
//
// Decimal end to end: each component is scaled by the exact fraction
// daysWorked/daysInMonth and rounded to paise ONCE, at the very end. Rounding
// mid-calculation (e.g. rounding the daily rate first) drifts by rupees over a
// full month, which is visible on a payslip.

import { Prisma } from "@prisma/client";
import type { Money } from "./compute.ts";

function d(v: Money): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v ?? 0);
}

function money(v: Prisma.Decimal): Prisma.Decimal {
  return v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export interface ProratedSalary {
  basic: Prisma.Decimal;
  hra: Prisma.Decimal;
  specialAllowance: Prisma.Decimal;
  daysWorked: number;
  daysInMonth: number;
}

/**
 * Scale each salary component by daysWorked/daysInMonth.
 *
 * Guards, in order:
 *  - daysInMonth <= 0 is nonsensical input → all zeros, never a divide by zero.
 *  - daysWorked <= 0 (joined after the period, or left before it) → all zeros.
 *  - daysWorked >= daysInMonth → components returned UNCHANGED, not
 *    recomputed as x * (n/n). Multiplying and dividing by the same number is
 *    exact in decimal arithmetic, but returning the input directly makes the
 *    full-month case provably identity rather than merely reliably identity.
 */
export function computeProratedSalary(
  basic: Money,
  hra: Money,
  specialAllowance: Money,
  daysWorked: number,
  daysInMonth: number,
): ProratedSalary {
  const b = d(basic);
  const h = d(hra);
  const s = d(specialAllowance);

  const dim = Number.isFinite(daysInMonth) ? Math.trunc(daysInMonth) : 0;
  const dw = Number.isFinite(daysWorked) ? Math.trunc(daysWorked) : 0;

  if (dim <= 0 || dw <= 0) {
    const z = new Prisma.Decimal(0);
    return {
      basic: z,
      hra: z,
      specialAllowance: z,
      daysWorked: Math.max(0, dw),
      daysInMonth: Math.max(0, dim),
    };
  }

  if (dw >= dim) {
    return {
      basic: money(b),
      hra: money(h),
      specialAllowance: money(s),
      daysWorked: dim,
      daysInMonth: dim,
    };
  }

  // Exact fraction, applied per component, rounded once at the end.
  const scale = (x: Prisma.Decimal) => money(x.times(dw).dividedBy(dim));
  return {
    basic: scale(b),
    hra: scale(h),
    specialAllowance: scale(s),
    daysWorked: dw,
    daysInMonth: dim,
  };
}

/** Calendar days in a "YYYY-MM" period. */
export function daysInPeriod(period: string): number {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m, 0).getDate(); // day 0 of next month = last day of this
}

/**
 * Payable days for one employee in one period, from their joining date and
 * (if they have left) their offboarding date.
 *
 * Both boundaries are INCLUSIVE — an employee who joins on the 1st and leaves
 * on the 31st of a 31-day month worked 31 days, not 30. An employee who joins
 * on the 12th of a 31-day month is owed 20 days (12th through 31st).
 *
 * Returns 0 when the employment window does not overlap the period at all.
 */
export function payableDays(
  period: string,
  joiningDate: Date,
  offboardedAt: Date | null,
): { daysWorked: number; daysInMonth: number } {
  const [y, m] = period.split("-").map(Number);
  const daysInMonth = daysInPeriod(period);
  const periodStart = new Date(y, m - 1, 1);
  const periodEnd = new Date(y, m - 1, daysInMonth); // inclusive last day

  const dayOnly = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());

  const start = dayOnly(joiningDate) > periodStart ? dayOnly(joiningDate) : periodStart;
  const end =
    offboardedAt && dayOnly(offboardedAt) < periodEnd ? dayOnly(offboardedAt) : periodEnd;

  if (end < start) return { daysWorked: 0, daysInMonth };

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  // Round rather than floor: a DST transition inside the period makes the
  // millisecond difference 23 or 25 hours short/long, which floor would
  // silently turn into an off-by-one day of pay.
  const daysWorked =
    Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1; // inclusive

  return { daysWorked: Math.min(daysWorked, daysInMonth), daysInMonth };
}
