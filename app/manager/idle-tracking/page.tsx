import { getEffectiveUserId } from "@/lib/auth";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { getEmployeeByClerkId, getDirectReports } from "@/lib/data/scope";
import { idleRowsFor, hm } from "@/lib/idle/aggregate";
import { consentLabel } from "@/lib/idle/consent";

export const dynamic = "force-dynamic";

async function load() {
  const userId = await getEffectiveUserId();
  if (!userId) return { manager: null, rows: [], error: null };
  try {
    const manager = await getEmployeeByClerkId(userId);
    if (!manager) return { manager: null, rows: [], error: null };

    // Direct reports only — the same single-level rule used everywhere else.
    const reports = await getDirectReports(manager.id);
    const rows = await idleRowsFor(
      reports.map((r) => ({
        id: r.id,
        name: r.name,
        employeeCode: r.employeeCode,
        department: r.department,
      })),
    );
    return { manager, rows, error: null };
  } catch (err) {
    console.error("[manager/idle-tracking] failed:", err);
    return { manager: null, rows: [], error: "Team data is unavailable right now." };
  }
}

export default async function ManagerIdleTrackingPage() {
  const { manager, rows, error } = await load();

  return (
    <>
      <PageHeader
        title="Team Activity"
        description="Roughly how much of tracked time your direct reports' machines were in use. Aggregates only — there is no minute-by-minute timeline here, by design."
      />

      {error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{error}</span>
        </Panel>
      )}

      {!manager && !error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="warn" />
          <span className="text-sm text-text-muted">
            No employee record is linked to your account yet.
          </span>
        </Panel>
      )}

      {manager && (
        <>
          <Panel className="mb-5 px-4 py-3">
            <div className="flex items-start gap-3 text-xs text-text-muted">
              <StatusDot state="idle" className="mt-1" />
              <p>
                This shows idle-vs-active minutes only. It does not show what
                anyone worked on, which applications they used, or any
                productivity score — and it is not part of appraisal. Treat a
                low figure as a prompt for a conversation, not a conclusion:
                someone in meetings all day or working away from their machine
                will read as idle here.
              </p>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title={`Direct Reports · ${rows.length}`} />
            {rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-text-muted">
                No direct reports.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
                      <th className="px-4 py-3 font-medium">Employee</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Today</th>
                      <th className="px-4 py-3 font-medium">This month</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r) => {
                      const tracked = r.consent.active && r.agent?.active;
                      return (
                        <tr key={r.employeeId}>
                          <td className="px-4 py-3">
                            <div className="text-text">{r.name}</div>
                            <div className="font-mono text-[11px] text-text-muted">
                              {r.employeeCode}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-2">
                              <StatusDot
                                state={
                                  !r.consent.active ? "warn" : tracked ? "good" : "idle"
                                }
                              />
                              <span className="text-xs text-text-muted">
                                {!r.consent.active
                                  ? consentLabel(r.consent)
                                  : r.agent?.active
                                    ? "Tracking"
                                    : "No agent installed"}
                              </span>
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {r.today.totalMinutes === 0 ? (
                              <span className="text-text-muted">—</span>
                            ) : (
                              <>
                                <span className="text-text">
                                  {r.today.activePct}% active
                                </span>
                                <span className="ml-1.5 text-text-muted">
                                  ({hm(r.today.activeMinutes)})
                                </span>
                              </>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {r.month.totalMinutes === 0 ? (
                              <span className="text-text-muted">—</span>
                            ) : (
                              <>
                                <span className="text-text">
                                  {r.month.activePct}% active
                                </span>
                                <span className="ml-1.5 text-text-muted">
                                  ({hm(r.month.activeMinutes)} of{" "}
                                  {hm(r.month.totalMinutes)} tracked)
                                </span>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
