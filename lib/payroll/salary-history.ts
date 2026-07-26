// Salary structure versioning — pure. No DB access.
//
// SalaryStructure holds the version CURRENTLY in force; SalaryStructureHistory
// holds every superseded one. Neither is the whole story on its own, so this
// module assembles the two into one ordered timeline and, separately, computes
// what a replacement should write.
//
// Half-open ranges, [effectiveFrom, effectiveTo): a version that ends on the
// day the next begins cannot overlap it, and there is no gap to explain. The
// current version's effectiveTo is null — it has not ended.
//
// NOTHING IN PAYROLL READS ANY OF THIS. Payroll resolves pay from the single
// current SalaryStructure row exactly as it always has; this is a reporting
// and audit surface only.

import { Prisma } from "@prisma/client";

/** "YYYY-MM-DD" from LOCAL components — effective dates are local midnight, and
 *  toISOString() would render them a day early east of Greenwich. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export interface SalaryVersionInput {
  basic: string;
  hra: string;
  specialAllowance: string;
  effectiveFrom: Date;
  setBy: string;
}

export interface SalaryTimelineEntry {
  versionNumber: number;
  basic: string;
  hra: string;
  specialAllowance: string;
  /** basic + hra + specialAllowance, as an exact decimal string. */
  gross: string;
  effectiveFrom: Date;
  /** Exclusive; null for the version in force. */
  effectiveTo: Date | null;
  current: boolean;
  setBy: string;
  supersededBy: string | null;
  supersededAt: Date | null;
  /** Change in gross against the previous version. Null for the first. */
  grossDelta: string | null;
}

/** Exact sum, never through a JS number — same rule as lib/payroll/compute.ts. */
export function grossOf(basic: string, hra: string, special: string): string {
  return new Prisma.Decimal(basic)
    .plus(new Prisma.Decimal(hra))
    .plus(new Prisma.Decimal(special))
    .toFixed(2);
}

export interface CurrentStructureRow {
  basic: string;
  hra: string;
  specialAllowance: string;
  effectiveFrom: Date;
  setBy: string;
}

export interface HistoryRow extends CurrentStructureRow {
  effectiveTo: Date;
  versionNumber: number;
  supersededBy: string;
  supersededAt: Date;
}

/**
 * The full salary timeline, oldest first.
 *
 * Takes the current row (or null, for an employee who never had a structure)
 * and every history row, and returns one ordered list with gross and the
 * change against the preceding version computed for each.
 */
export function buildSalaryTimeline(
  current: CurrentStructureRow | null,
  history: HistoryRow[],
): SalaryTimelineEntry[] {
  const past = [...history].sort(
    (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime() || a.versionNumber - b.versionNumber,
  );

  const entries: SalaryTimelineEntry[] = past.map((h) => ({
    versionNumber: h.versionNumber,
    basic: h.basic,
    hra: h.hra,
    specialAllowance: h.specialAllowance,
    gross: grossOf(h.basic, h.hra, h.specialAllowance),
    effectiveFrom: h.effectiveFrom,
    effectiveTo: h.effectiveTo,
    current: false,
    setBy: h.setBy,
    supersededBy: h.supersededBy,
    supersededAt: h.supersededAt,
    grossDelta: null,
  }));

  if (current) {
    entries.push({
      // The current version sits one above the highest closed one.
      versionNumber: nextVersionNumber(history),
      basic: current.basic,
      hra: current.hra,
      specialAllowance: current.specialAllowance,
      gross: grossOf(current.basic, current.hra, current.specialAllowance),
      effectiveFrom: current.effectiveFrom,
      effectiveTo: null,
      current: true,
      setBy: current.setBy,
      supersededBy: null,
      supersededAt: null,
      grossDelta: null,
    });
  }

  // Deltas, once the list is ordered.
  for (let i = 1; i < entries.length; i++) {
    entries[i].grossDelta = new Prisma.Decimal(entries[i].gross)
      .minus(new Prisma.Decimal(entries[i - 1].gross))
      .toFixed(2);
  }

  return entries;
}

/** Version number the NEXT closed version should carry. */
export function nextVersionNumber(history: { versionNumber: number }[]): number {
  return history.reduce((max, h) => Math.max(max, h.versionNumber), 0) + 1;
}

export type SupersedeResult =
  | {
      ok: true;
      /** The row to append to SalaryStructureHistory. Null on a first-ever set. */
      historyRow: {
        basic: string;
        hra: string;
        specialAllowance: string;
        effectiveFrom: Date;
        effectiveTo: Date;
        versionNumber: number;
        setBy: string;
        supersededBy: string;
      } | null;
    }
  | { ok: false; code: "NOT_AFTER_CURRENT"; message: string };

/**
 * Work out what replacing the current structure implies.
 *
 * The new version's effectiveFrom must be strictly AFTER the current one's,
 * otherwise the closed range would be empty or inverted — a structure that was
 * never in force for a single day, which would corrupt the timeline rather
 * than record a correction. (Correcting a mistyped current structure is a
 * different operation from raising someone, and is refused here rather than
 * silently producing a zero-length version.)
 */
export function supersede(args: {
  current: CurrentStructureRow | null;
  history: { versionNumber: number }[];
  newEffectiveFrom: Date;
  actorUserId: string;
}): SupersedeResult {
  const { current, history, newEffectiveFrom, actorUserId } = args;

  if (!current) return { ok: true, historyRow: null };

  if (newEffectiveFrom <= current.effectiveFrom) {
    return {
      ok: false,
      code: "NOT_AFTER_CURRENT",
      message: `The new structure must take effect after the current one (${ymd(
        current.effectiveFrom,
      )}). To correct a mistake in the current structure rather than record a change, adjust the existing effective date first.`,
    };
  }

  return {
    ok: true,
    historyRow: {
      basic: current.basic,
      hra: current.hra,
      specialAllowance: current.specialAllowance,
      effectiveFrom: current.effectiveFrom,
      effectiveTo: newEffectiveFrom,
      versionNumber: nextVersionNumber(history),
      setBy: current.setBy,
      supersededBy: actorUserId,
    },
  };
}
