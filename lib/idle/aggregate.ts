import "server-only";
import { db } from "@/lib/db";
import { idleConsentStates, type ConsentState } from "./consent";

/**
 * Idle/active aggregates for the HR, Manager and Employee views.
 *
 * BATCHED BY CONSTRUCTION: every function here takes a LIST of employee ids
 * and issues a fixed number of queries — a groupBy for the totals, one findMany
 * for consent, one for tokens. Adding employees adds rows to those results, not
 * queries, so none of these views become N+1 as headcount grows.
 *
 * Aggregates ONLY. There is no function here that returns individual IdleLog
 * rows for someone else's employee, and no minute-by-minute timeline: the
 * Manager view is meant to read as "roughly X% active this month", not as a
 * surveillance log.
 */

export interface IdleTotals {
  idleMinutes: number;
  activeMinutes: number;
  totalMinutes: number;
  /** Share of tracked time that was active, 0-100, or null when no data. */
  activePct: number | null;
}

export interface EmployeeIdleRow {
  employeeId: string;
  name: string;
  employeeCode: string;
  department: string;
  consent: ConsentState;
  agent: { active: boolean; lastSeenAt: Date | null } | null;
  today: IdleTotals;
  month: IdleTotals;
}

function totals(idle: number, active: number): IdleTotals {
  const total = idle + active;
  return {
    idleMinutes: idle,
    activeMinutes: active,
    totalMinutes: total,
    activePct: total > 0 ? Math.round((active / total) * 100) : null,
  };
}

export function monthBounds(now = new Date()) {
  return {
    monthStart: new Date(now.getFullYear(), now.getMonth(), 1),
    monthEnd: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

export function dayBounds(now = new Date()) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    dayStart,
    dayEnd: new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1),
  };
}

/**
 * Per-employee today + month-to-date totals, plus consent and agent state.
 *
 * FIVE queries total, regardless of how many employees are passed in.
 */
export async function idleRowsFor(
  employees: { id: string; name: string; employeeCode: string; department: string }[],
  now = new Date(),
): Promise<EmployeeIdleRow[]> {
  const ids = employees.map((e) => e.id);
  if (ids.length === 0) return [];

  const { dayStart, dayEnd } = dayBounds(now);
  const { monthStart, monthEnd } = monthBounds(now);

  const [todayGroups, monthGroups, tokens, consents] = await Promise.all([
    db.idleLog.groupBy({
      by: ["employeeId"],
      where: { employeeId: { in: ids }, date: { gte: dayStart, lt: dayEnd } },
      _sum: { idleMinutes: true, activeMinutes: true },
    }),
    db.idleLog.groupBy({
      by: ["employeeId"],
      where: { employeeId: { in: ids }, date: { gte: monthStart, lt: monthEnd } },
      _sum: { idleMinutes: true, activeMinutes: true },
    }),
    db.agentToken.findMany({
      where: { employeeId: { in: ids } },
      select: { employeeId: true, active: true, lastSeenAt: true },
    }),
    idleConsentStates(db, ids, now),
  ]);

  const todayBy = new Map(todayGroups.map((g) => [g.employeeId, g._sum]));
  const monthBy = new Map(monthGroups.map((g) => [g.employeeId, g._sum]));
  const tokenBy = new Map(tokens.map((t) => [t.employeeId, t]));

  return employees.map((e) => {
    const t = todayBy.get(e.id);
    const m = monthBy.get(e.id);
    const tok = tokenBy.get(e.id);
    return {
      employeeId: e.id,
      name: e.name,
      employeeCode: e.employeeCode,
      department: e.department,
      consent: consents.get(e.id) ?? { active: false, reason: "NEVER_GIVEN" },
      agent: tok ? { active: tok.active, lastSeenAt: tok.lastSeenAt } : null,
      today: totals(t?.idleMinutes ?? 0, t?.activeMinutes ?? 0),
      month: totals(m?.idleMinutes ?? 0, m?.activeMinutes ?? 0),
    };
  });
}

/** One employee's own totals — for the employee dashboard card. */
export async function ownIdleTotals(
  employeeId: string,
  now = new Date(),
): Promise<{ today: IdleTotals; month: IdleTotals; consent: ConsentState }> {
  const { dayStart, dayEnd } = dayBounds(now);
  const { monthStart, monthEnd } = monthBounds(now);

  const [t, m, consents] = await Promise.all([
    db.idleLog.aggregate({
      where: { employeeId, date: { gte: dayStart, lt: dayEnd } },
      _sum: { idleMinutes: true, activeMinutes: true },
    }),
    db.idleLog.aggregate({
      where: { employeeId, date: { gte: monthStart, lt: monthEnd } },
      _sum: { idleMinutes: true, activeMinutes: true },
    }),
    idleConsentStates(db, [employeeId], now),
  ]);

  return {
    today: totals(t._sum.idleMinutes ?? 0, t._sum.activeMinutes ?? 0),
    month: totals(m._sum.idleMinutes ?? 0, m._sum.activeMinutes ?? 0),
    consent: consents.get(employeeId) ?? { active: false, reason: "NEVER_GIVEN" },
  };
}

/** "6h 30m" from minutes. */
export function hm(minutes: number): string {
  if (minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** How stale is an agent? Used to flag a machine that has gone silent. */
export function agentFreshness(
  lastSeenAt: Date | null,
  now = new Date(),
): { label: string; state: "good" | "warn" | "danger" | "idle" } {
  if (!lastSeenAt) return { label: "never reported", state: "idle" };
  const mins = Math.floor((now.getTime() - lastSeenAt.getTime()) / 60000);
  if (mins < 30) return { label: `${mins}m ago`, state: "good" };
  if (mins < 60 * 24) {
    const h = Math.floor(mins / 60);
    return { label: `${h}h ago`, state: "warn" };
  }
  const d = Math.floor(mins / (60 * 24));
  return { label: `${d}d ago`, state: "danger" };
}
