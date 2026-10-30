// The ONE "can this cycle be published?" rule, shared by the publish API and the
// HR page's Publish button so the two can never disagree again. (They did: the
// page counted excluded people as incomplete, so Publish stayed disabled after
// Exclude while the API would have accepted it.)
//
// Pure. No DB access — safe to import from a client component.

export interface CycleScoreState {
  employeeId: string;
  finalScore: number | null;
  excluded: boolean;
}

/**
 * In-scope employees that block publishing: no score row yet, or not scored
 * and not excluded. An excluded employee never blocks, scored or not.
 */
export function publishBlockers(inScopeIds: string[], rows: CycleScoreState[]): string[] {
  const byEmp = new Map(rows.map((r) => [r.employeeId, r]));
  return inScopeIds.filter((id) => {
    const row = byEmp.get(id);
    return !row || (row.finalScore === null && !row.excluded);
  });
}

/** Publishable when nobody blocks and at least one employee is in scope. */
export function canPublishCycle(inScopeIds: string[], rows: CycleScoreState[]): boolean {
  return inScopeIds.length > 0 && publishBlockers(inScopeIds, rows).length === 0;
}

