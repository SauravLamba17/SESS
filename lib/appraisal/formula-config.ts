import type { PrismaClient } from "@prisma/client";

/**
 * Reading the configured appraisal formula — shared by the API route and the
 * Super Admin page's server-side initial load.
 *
 * This lives here so the page can render its first paint from the database
 * directly (the pattern every other interactive page in the app uses) without
 * restating the department→global fallback. Two copies of that fallback is how
 * the page and the endpoint would start disagreeing about which formula is in
 * force, which is exactly the thing a formula config must never be vague about.
 */

export const ZERO_WEIGHTS = {
  punctuality: 0,
  production: 0,
  quality: 0,
  feedback: 0,
  warningPenaltyPoints: 0,
  // Phase 8: punctuality frequency/severity split — the 4 main weights start at
  // 0 (must be set), but these get sensible suggested defaults since 0/0 is
  // never valid (they must sum to 100).
  punctualityFrequencyWeight: 70,
  punctualitySeverityWeight: 30,
  punctualitySeverityCapMinutes: 60,
};

export type FormulaWeights = typeof ZERO_WEIGHTS;

/** "" and "global" both mean the global default, which is stored as NULL. */
export function normalizeDepartment(raw: string | null): string | null {
  if (raw === null) return null;
  const t = raw.trim();
  return t === "" || t.toLowerCase() === "global" ? null : t;
}

export interface ResolvedFormula {
  department: string | null;
  weights: FormulaWeights;
  source: "department" | "global" | "none";
  configured: boolean;
}

/**
 * Exact department match first, falling back to the global (null) formula.
 * Never invents weights: with nothing saved anywhere, the explicit zeros come
 * back and `configured` is false.
 */
export async function resolveFormula(
  db: Pick<PrismaClient, "appraisalFormula">,
  dept: string | null,
): Promise<ResolvedFormula> {
  const own = await db.appraisalFormula.findFirst({ where: { department: dept } });
  const globalOne =
    dept === null ? own : await db.appraisalFormula.findFirst({ where: { department: null } });
  const resolved = own ?? globalOne;

  return {
    department: dept,
    weights: (resolved?.weightsJson as FormulaWeights | undefined) ?? ZERO_WEIGHTS,
    source: own ? "department" : globalOne ? "global" : "none",
    configured: !!resolved,
  };
}
