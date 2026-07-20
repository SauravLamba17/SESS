/**
 * Group payroll rows so a correction is displayed attached to the row it
 * corrects, rather than as a second row that merely happens to share a month.
 *
 * Pure — callers fetch rows however they like and pass them in.
 */

export interface LinkableRow {
  id: string;
  month: string;
  adjustmentForPayrollId: string | null;
  finalizedAt: Date | null;
}

export interface RowChain<T extends LinkableRow> {
  original: T;
  /** Corrections against `original`, oldest first. */
  adjustments: T[];
}

/**
 * Returns one chain per original row, each carrying its adjustments.
 *
 * An adjustment whose original is not in the supplied set (e.g. a page showing
 * a single period, where the original belongs to another query) is surfaced as
 * its own chain rather than dropped — silently hiding a payroll row is worse
 * than showing it unlinked.
 */
export function linkAdjustments<T extends LinkableRow>(rows: T[]): RowChain<T>[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const chains = new Map<string, RowChain<T>>();

  // Originals first, so ordering follows the caller's sort.
  for (const r of rows) {
    if (r.adjustmentForPayrollId === null) {
      chains.set(r.id, { original: r, adjustments: [] });
    }
  }

  /**
   * Walk up to the ROOT original. A correction may itself be corrected once it
   * is finalized, so `adjustmentForPayrollId` can point at another adjustment.
   * The whole chain belongs under the original payslip it ultimately corrects.
   * Bounded so a cyclic pointer can never spin forever.
   */
  function rootOf(row: T): string | null {
    let cursor: T | undefined = row;
    for (let hops = 0; hops < 32 && cursor; hops++) {
      if (cursor.adjustmentForPayrollId === null) return cursor.id;
      const parent: T | undefined = byId.get(cursor.adjustmentForPayrollId);
      if (!parent) return null; // ancestor outside this result set
      cursor = parent;
    }
    return null;
  }

  const orphans: T[] = [];
  for (const r of rows) {
    if (r.adjustmentForPayrollId === null) continue;
    const rootId = rootOf(r);
    const chain = rootId ? chains.get(rootId) : undefined;
    if (chain) chain.adjustments.push(r);
    else orphans.push(r);
  }

  // Oldest correction first — the chain reads in the order it happened.
  for (const chain of Array.from(chains.values())) {
    chain.adjustments.sort((a, b) => {
      const at = a.finalizedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bt = b.finalizedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return at - bt;
    });
  }

  return [
    ...Array.from(chains.values()),
    ...orphans.map((o) => ({ original: o, adjustments: [] as T[] })),
  ];
}

/** "adjustment, finalized 3 Aug 2026" / "adjustment, draft". */
export function adjustmentLabel(row: {
  finalizedAt: Date | null;
  status: string;
}): string {
  if (row.status !== "FINALIZED" || !row.finalizedAt)
    return `adjustment, ${row.status.toLowerCase()}`;
  return `adjustment, finalized ${row.finalizedAt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}
