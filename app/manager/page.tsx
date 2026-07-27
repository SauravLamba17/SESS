import { getEffectiveUserId } from "@/lib/auth";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader, StatCard } from "@/components/ui/panel";
import { StatusDot, type StatusState } from "@/components/ui/status-dot";
import { db } from "@/lib/db";
import { getEmployeeByClerkId, getDirectReports } from "@/lib/data/scope";
import { currentPeriod } from "@/lib/period";
import { TodayWidgets } from "@/components/engagement/today-widgets";
import { loadToday } from "@/lib/engagement/today";
import { ErrorPanel, UnlinkedEmployeeNotice } from "@/components/ui/notice";

export const dynamic = "force-dynamic";

function punctualityState(pct: number | null): StatusState {
  if (pct === null) return "idle";
  if (pct >= 95) return "good";
  if (pct >= 85) return "warn";
  return "danger";
}

function productionState(pct: number | null): StatusState {
  if (pct === null) return "idle";
  if (pct >= 100) return "good";
  if (pct >= 80) return "warn";
  return "danger";
}

/** Same thresholds as the Team Quality page, so a score reads identically in both. */
function qualityState(score: number | null): StatusState {
  if (score === null) return "idle";
  if (score >= 90) return "good";
  if (score >= 75) return "warn";
  return "danger";
}

async function load() {
  const userId = await getEffectiveUserId();
  if (!userId) return { manager: null, error: null };
  try {
    const manager = await getEmployeeByClerkId(userId);
    if (!manager) return { manager: null, error: null };

    const { period, monthStart, monthEnd } = currentPeriod();
    const reports = await getDirectReports(manager.id);
    const ids = reports.map((r) => r.id);
    const inMonth = { gte: monthStart, lt: monthEnd };
    const scope = { managerId: manager.id };

    // All set-based aggregates — independent of team size (no N+1).
    const [totals, lates, actuals, targets, pendingApprovals, quality] = await Promise.all([
      db.attendance.groupBy({
        by: ["employeeId"],
        where: { employee: scope, date: inMonth },
        _count: { _all: true },
      }),
      db.attendance.groupBy({
        by: ["employeeId"],
        where: { employee: scope, date: inMonth, lateFlag: true },
        _count: { _all: true },
      }),
      db.production.groupBy({
        by: ["employeeId"],
        where: { employeeId: { in: ids }, date: inMonth },
        _sum: { unitsProduced: true },
      }),
      db.monthlyTarget.findMany({ where: { period, employeeId: { in: ids } } }),
      db.leaveRequest.count({ where: { status: "PENDING", employee: scope } }),
      // Same query the Team Quality page runs for the same manager's reports:
      // this month's rows, newest first, so the first row per employee is the
      // latest. One query for the whole team — no N+1.
      db.qualityReport.findMany({
        where: { employeeId: { in: ids }, date: inMonth },
        orderBy: { date: "desc" },
        select: { employeeId: true, qualityScore: true, date: true },
      }),
    ]);

    const totalBy = new Map(totals.map((g) => [g.employeeId, g._count._all]));
    const lateBy = new Map(lates.map((g) => [g.employeeId, g._count._all]));
    const actualBy = new Map(actuals.map((a) => [a.employeeId, a._sum.unitsProduced ?? 0]));
    const targetBy = new Map(targets.map((t) => [t.employeeId, t.targetUnits]));
    const qualityBy = new Map<string, number>();
    for (const q of quality) if (!qualityBy.has(q.employeeId)) qualityBy.set(q.employeeId, q.qualityScore);

    const rows = reports.map((r) => {
      const total = totalBy.get(r.id) ?? 0;
      const late = lateBy.get(r.id) ?? 0;
      const punctuality = total > 0 ? Math.round((1 - late / total) * 100) : null;
      const actual = actualBy.get(r.id) ?? 0;
      const target = targetBy.get(r.id) ?? null;
      const prodPct = target && target > 0 ? Math.round((actual / target) * 100) : null;
      const quality = qualityBy.get(r.id) ?? null;
      return { r, punctuality, actual, target, prodPct, quality };
    });

    const totalLate = lates.reduce((s, g) => s + g._count._all, 0);
    return { manager, error: null, rows, pendingApprovals, totalLate, targetsSet: targets.length };
  } catch (err) {
    console.error("[manager/dashboard] failed:", err);
    return { manager: null, error: "Team data is unavailable right now." };
  }
}

export default async function ManagerDashboard() {
  const [data, today] = await Promise.all([load(), loadToday()]);

  return (
    <>
      <PageHeader
        title="Team Dashboard"
        description="Your direct reports only. Multi-level reports are not visible to you."
      />

      <TodayWidgets data={today} />

      {data.error && (
        <ErrorPanel>{data.error}</ErrorPanel>
      )}

      {!data.manager && !data.error && (
        <UnlinkedEmployeeNotice />
      )}

      {data.manager && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Direct Reports" value={data.rows.length} state="good" />
            <StatCard
              label="Pending Approvals"
              value={data.pendingApprovals}
              state={data.pendingApprovals > 0 ? "warn" : "good"}
              status="Leave requests"
            />
            <StatCard
              label="Late Marks · MTD"
              value={data.totalLate}
              state={data.totalLate > 0 ? "warn" : "good"}
            />
            <StatCard
              label="Targets Set"
              value={`${data.targetsSet} / ${data.rows.length}`}
              state={data.targetsSet === data.rows.length ? "good" : "warn"}
              status="This month"
            />
          </div>

          <div className="mt-6">
            <Panel>
              <PanelHeader
                title="Direct Reports"
                action={
                  <span className="flex items-center gap-2 text-xs text-text-muted">
                    <StatusDot state="idle" />
                    Direct reports only — no multi-level descent
                  </span>
                }
              />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
                      <th className="px-4 py-3 font-medium">Employee</th>
                      <th className="px-4 py-3 font-medium">Punctuality (MTD)</th>
                      <th className="px-4 py-3 font-medium">Production (MTD)</th>
                      <th className="px-4 py-3 font-medium">Quality</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.rows.map(({ r, punctuality, actual, target, prodPct, quality }) => (
                      <tr key={r.id}>
                        <td className="px-4 py-3">
                          <div className="text-text">{r.name}</div>
                          <div className="font-mono text-xs text-text-muted">
                            {r.employeeCode}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-2">
                            <StatusDot state={punctualityState(punctuality)} />
                            <span className="font-mono text-text">
                              {punctuality === null ? "—" : `${punctuality}%`}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-2">
                            <StatusDot state={productionState(prodPct)} />
                            <span className="font-mono text-text">
                              {actual}
                              <span className="text-text-muted">
                                {" / "}
                                {target === null ? "—" : target}
                              </span>
                              {prodPct !== null && (
                                <span className="ml-1.5 text-text-muted">({prodPct}%)</span>
                              )}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {/* Latest quality score this month — same source and
                              thresholds as the Team Quality page. */}
                          <span className="inline-flex items-center gap-2">
                            <StatusDot state={qualityState(quality)} />
                            <span
                              className={
                                quality === null
                                  ? "font-mono text-text-muted"
                                  : "font-mono text-text"
                              }
                            >
                              {quality === null ? "—" : quality}
                            </span>
                          </span>
                        </td>
                      </tr>
                    ))}
                    {data.rows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-text-muted">
                          No direct reports.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
