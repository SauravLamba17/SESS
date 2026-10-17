import { getEffectiveUserId } from "@/lib/auth";
import { loadManagerDashboard } from "@/lib/dashboard/manager";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader, StatCard } from "@/components/ui/panel";
import { StatusDot, type StatusState } from "@/components/ui/status-dot";
import { TodayWidgets } from "@/components/engagement/today-widgets";
import { loadToday } from "@/lib/engagement/today";
import { ErrorPanel, UnlinkedEmployeeNotice } from "@/components/ui/notice";
// A manager tracks their OWN attendance exactly as an employee does. The widget
// and these cards are the same components the Employee dashboard renders — the
// punch route is role-agnostic and always resolves the caller's own Employee
// record, so no API change was needed.
import { ClockInWidget } from "@/components/employee/clock-in-widget";
import {
  ShiftBanner,
  TodayAttendanceCard,
  WeekAttendancePanel,
} from "@/components/attendance/own-attendance";

export const dynamic = "force-dynamic";

// Tab title for this route; the root layout appends " · SESS".
export const metadata = { title: "Team Dashboard" };

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
    return await loadManagerDashboard(userId);
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
          {/* ── Your own attendance ──────────────────────────────────────
              Identical to the Employee dashboard: same ClockInWidget, same
              cards, same punch endpoint. A manager records their own
              attendance like anyone else. */}
          <div className="mb-4">
            <ClockInWidget
              initialCheckIn={data.own.punchRow?.checkIn ? data.own.punchRow.checkIn.toISOString() : null}
              initialCheckOut={data.own.punchRow?.checkOut ? data.own.punchRow.checkOut.toISOString() : null}
            />
          </div>

          <ShiftBanner shift={data.own.shift} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <TodayAttendanceCard today={data.own.today} />
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
            <WeekAttendancePanel
              weekStart={data.own.weekStart}
              weekByDate={data.own.weekByDate}
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
                  <caption className="sr-only">
                    Your direct reports, with month-to-date punctuality,
                    production against target, and latest quality score.
                  </caption>
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
                      <th scope="col" className="px-4 py-3 font-medium">Employee</th>
                      <th scope="col" className="px-4 py-3 font-medium">Punctuality (MTD)</th>
                      <th scope="col" className="px-4 py-3 font-medium">Production (MTD)</th>
                      <th scope="col" className="px-4 py-3 font-medium">Quality</th>
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
