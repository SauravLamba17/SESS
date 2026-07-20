/**
 * Pure engagement logic — no DB, no I/O, no server-only imports.
 *
 * Split out from today.ts / pulse.ts so the verification script can exercise
 * the REAL derivation rather than a re-implementation of it. Those modules
 * import lib/db (which is server-only), so a standalone Node script cannot
 * load them; this file it can.
 */

export type PresenceStatus = "IN" | "ON_LEAVE" | "NOT_MARKED";

export interface PresenceRow {
  id: string;
  name: string;
  department: string;
  status: PresenceStatus;
}

export interface EmployeeLike {
  id: string;
  name: string;
  department: string;
  dateOfBirth?: Date | null;
}

/**
 * Derive today's presence from the two id sets.
 *
 * Takes SETS OF IDS, not attendance rows — so there is no parameter through
 * which lateFlag, lateMinutes or a check-in time could reach this function,
 * let alone the UI. Presence is not performance.
 */
export function derivePresence(
  employees: EmployeeLike[],
  checkedInIds: Set<string>,
  onLeaveIds: Set<string>,
): PresenceRow[] {
  return employees.map((e) => ({
    id: e.id,
    name: e.name,
    department: e.department,
    // Approved leave wins over a stray punch: someone on leave who also
    // checked in is still, for this widget, on leave.
    status: onLeaveIds.has(e.id)
      ? "ON_LEAVE"
      : checkedInIds.has(e.id)
        ? "IN"
        : "NOT_MARKED",
  }));
}

export function presenceCounts(rows: PresenceRow[]) {
  return {
    in: rows.filter((r) => r.status === "IN").length,
    onLeave: rows.filter((r) => r.status === "ON_LEAVE").length,
    notMarked: rows.filter((r) => r.status === "NOT_MARKED").length,
    total: rows.length,
  };
}

/**
 * Whose birthday is today — month and day only, year ignored.
 *
 * Returns name + department ONLY. The stored date never leaves this function
 * and no age is computed anywhere, by design: this is a celebratory nudge,
 * not an age disclosure.
 */
export function matchBirthdays(
  employees: EmployeeLike[],
  now: Date,
): { id: string; name: string; department: string }[] {
  const m = now.getMonth();
  const d = now.getDate();
  return employees
    .filter(
      (e) => e.dateOfBirth && e.dateOfBirth.getMonth() === m && e.dateOfBirth.getDate() === d,
    )
    .map((e) => ({ id: e.id, name: e.name, department: e.department }));
}

export interface PulseAggregate {
  surveyId: string;
  responseCount: number;
  average: number | null;
  distribution: { rating: number; count: number }[];
}

/**
 * Turn per-rating counts into an aggregate.
 *
 * Input is {ratingValue, count} pairs — counts, never individual responses.
 * There is no parameter here capable of carrying an identity, so the
 * aggregation step cannot leak one even in principle.
 */
export function computeAggregate(
  surveyId: string,
  groups: { ratingValue: number; count: number }[],
  scaleMin: number,
  scaleMax: number,
): PulseAggregate {
  const countBy = new Map(groups.map((g) => [g.ratingValue, g.count]));

  const distribution: { rating: number; count: number }[] = [];
  for (let r = scaleMin; r <= scaleMax; r++) {
    distribution.push({ rating: r, count: countBy.get(r) ?? 0 });
  }

  const responseCount = groups.reduce((s, g) => s + g.count, 0);
  const weighted = groups.reduce((s, g) => s + g.ratingValue * g.count, 0);

  return {
    surveyId,
    responseCount,
    average: responseCount > 0 ? Number((weighted / responseCount).toFixed(2)) : null,
    distribution,
  };
}
