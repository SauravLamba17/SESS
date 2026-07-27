import { Prisma } from "@prisma/client";

/**
 * Parse a money input to a NON-NEGATIVE Decimal, or null if malformed.
 *
 * Kept as a STRING all the way into Decimal — never through Number(). Routing
 * a rupee figure through a float is how 1234.55 becomes 1234.5499999999999,
 * and payroll rows are compared and summed exactly.
 *
 * UNSIGNED BY DESIGN, and deliberately not parameterised. A salary structure,
 * a salary advance and a normal payroll row must never accept a negative
 * amount — a negative basic or a negative advance is not a correction, it is a
 * data-entry accident that would silently invert a payment. Only an ADJUSTMENT
 * row legitimately carries a negative delta, and that one case has its own
 * parser local to app/api/hr/payroll/row/route.ts, gated on the row actually
 * being an adjustment. Adding a `signed` flag here would put that capability
 * one boolean away from every caller, which is exactly what this split avoids.
 *
 * Bounds: up to 10 integer digits and at most 2 decimals.
 */
export function parseMoney(v: unknown): Prisma.Decimal | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  try {
    return new Prisma.Decimal(s);
  } catch {
    return null;
  }
}
