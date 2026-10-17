import "server-only";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { getTeamRoster } from "@/lib/cache/employees";
import { getPendingLeaveCount } from "@/lib/cache/dashboard";
import { currentPeriod } from "@/lib/period";
import { loadOwnAttendance } from "@/lib/attendance/own-summary";
// TEMPORARY Server-Timing diagnostics — pass-through on normal requests.
import { timed } from "@/lib/server-timing";

/**
 * Everything the Team Dashboard (app/manager/page.tsx) needs for one manager.
 *
 * Statement count: identity 1, roster 1 (ORANGE cache), team metrics 1,
 * pending approvals 1 (ORANGE cache), own attendance 2 — it was thirteen.
 *
 * SCOPE is exactly what it was. Punch and late counts cover every employee
 * whose managerId is this manager (the old `employee: { managerId }` filter);
 * production, targets and quality are read for the same set and shown only for
 * the cached roster — active DIRECT reports, single level, no recursive
 * descent. Nothing about any other team can enter this statement.
 */
export async function loadManagerDashboard(clerkId: string) {
  const manager = await timed("mgr-identity", () => getEmployeeByClerkId(clerkId));
  if (!manager) return { manager: null, error: null };

  const { period, monthStart, monthEnd } = currentPeriod();
  // ORANGE TIER (SESS_Caching_Strategy.docx §2/§4) — manager/team roster,
  // 60 s, dropped by tag on any roster or shift change. A display projection
  // of the SAME direct-reports-only query (managerId + active, single level,
  // no recursive descent) — not a wider one.
  const reports = await timed("mgr-roster", () => getTeamRoster(manager.id));

  const [team, pendingApprovals, own] = await Promise.all([
    // Per team member, this month: punches, late punches, units produced, the
    // month's target, and the LATEST quality score (newest date first, as the
    // Team Quality page reads it). One statement for the whole team — no N+1.
    timed("mgr-team-metrics", () => db.$queryRaw<
      { id: string; total: number; late: number; actual: number; target: number | null; quality: number | null }[]
    >`
      SELECT e.id,
        (SELECT count(*) FROM "Attendance" a
          WHERE a."employeeId" = e.id AND a.date >= ${monthStart} AND a.date < ${monthEnd})::int AS total,
        (SELECT count(*) FROM "Attendance" a
          WHERE a."employeeId" = e.id AND a.date >= ${monthStart} AND a.date < ${monthEnd} AND a."lateFlag")::int AS late,
        (SELECT coalesce(sum(p."unitsProduced"), 0) FROM "Production" p
          WHERE p."employeeId" = e.id AND p.date >= ${monthStart} AND p.date < ${monthEnd})::int AS actual,
        (SELECT t."targetUnits" FROM "MonthlyTarget" t
          WHERE t."employeeId" = e.id AND t.period = ${period}) AS target,
        (SELECT q."qualityScore" FROM "QualityReport" q
          WHERE q."employeeId" = e.id AND q.date >= ${monthStart} AND q.date < ${monthEnd}
          ORDER BY q.date DESC LIMIT 1) AS quality
      FROM "Employee" e
      WHERE e."managerId" = ${manager.id}`),
    // ORANGE TIER (§2/§4) — pending-approvals COUNT, 60 s, invalidated the
    // moment a decision is made. Only the number is cached; the list of
    // requests the manager acts on is read fresh on /manager/attendance, and
    // the decision itself is gated by the atomic where-clause in
    // app/api/manager/leave/route.ts, never by anything cached.
    timed("mgr-pending", () => getPendingLeaveCount(manager.id)),
    // The manager's own row — scoped to manager.id, never to a report's id.
    timed("mgr-own-attendance", () => loadOwnAttendance(manager.id, manager.shiftId)),
  ]);

  const byId = new Map(team.map((t) => [t.id, t]));
  const rows = reports.map((r) => {
    const m = byId.get(r.id);
    const total = m?.total ?? 0;
    const late = m?.late ?? 0;
    const punctuality = total > 0 ? Math.round((1 - late / total) * 100) : null;
    const actual = m?.actual ?? 0;
    const target = m?.target ?? null;
    const prodPct = target && target > 0 ? Math.round((actual / target) * 100) : null;
    const quality = m?.quality ?? null;
    return { r, punctuality, actual, target, prodPct, quality };
  });

  const totalLate = team.reduce((s, t) => s + t.late, 0);
  const targetsSet = reports.filter((r) => byId.get(r.id)?.target != null).length;
  return { manager, error: null, rows, pendingApprovals, totalLate, targetsSet, own };
}
