import Link from "next/link";
import { MonitorSmartphone, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader, StatCard } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { PrintButton } from "@/components/ui/print-button";
import { AgentTokenManager } from "@/components/hr/agent-token-manager";
import { db } from "@/lib/db";
import { idleRowsFor, hm, agentFreshness } from "@/lib/idle/aggregate";
import { consentLabel } from "@/lib/idle/consent";
import { idleThresholdSeconds } from "@/lib/idle/settings";
import { ErrorPanel } from "@/components/ui/notice";

export const dynamic = "force-dynamic";

async function load() {
  try {
    const employees = await db.employee.findMany({
      where: { active: true },
      select: { id: true, name: true, employeeCode: true, department: true },
      orderBy: [{ department: "asc" }, { name: "asc" }],
    });
    // idleRowsFor issues a FIXED number of queries regardless of headcount.
    const [rows, threshold] = await Promise.all([
      idleRowsFor(employees),
      idleThresholdSeconds(),
    ]);
    return { rows, threshold, error: null };
  } catch (err) {
    console.error("[hr/idle-tracking] failed:", err);
    return { rows: [], threshold: 210, error: "Idle tracking data is unavailable right now." };
  }
}

export default async function HrIdleTrackingPage() {
  const { rows, threshold, error } = await load();

  const withAgent = rows.filter((r) => r.agent?.active);
  const consented = rows.filter((r) => r.consent.active);
  const stalled = withAgent.filter(
    (r) => agentFreshness(r.agent!.lastSeenAt).state === "danger",
  );

  return (
    <>
      <PageHeader
        title="Idle Tracking"
        description="Idle-vs-active minutes from company machines. Consent-gated: no active consent, no tracking."
        action={<PrintButton label="Print report" />}
      />

      {error && (
        <ErrorPanel>{error}</ErrorPanel>
      )}

      <Panel className="mb-5 px-4 py-3 print:hidden">
        <div className="flex items-start gap-3">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-text-muted" />
          <div className="text-xs text-text-muted">
            <p className="text-text">What this records — and what it does not</p>
            <p className="mt-1">
              Only idle-vs-active minutes, from whether the machine received
              keyboard or mouse input within{" "}
              <span className="font-mono text-text">{threshold}s</span>. No
              screenshots, no application or website tracking, no keystrokes, and
              no productivity scoring. The desktop agent is visible in the
              employee&apos;s system tray at all times and can be paused by them.
              Issue a token only after recording consent on{" "}
              <Link href="/hr/compliance" className="text-accent underline">
                Compliance &amp; Consent
              </Link>
              .
            </p>
          </div>
        </div>
      </Panel>

      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          label="Consented"
          value={`${consented.length} / ${rows.length}`}
          state={consented.length > 0 ? "good" : "idle"}
          status="Active IDLE_TRACKING consent"
        />
        <StatCard
          label="Agents Issued"
          value={withAgent.length}
          state={withAgent.length > 0 ? "good" : "idle"}
          status="Active tokens"
        />
        <StatCard
          label="Silent Agents"
          value={stalled.length}
          state={stalled.length > 0 ? "warn" : "good"}
          status={stalled.length > 0 ? "No report in 24h+" : "All reporting"}
        />
        <StatCard
          label="Idle Threshold"
          value={`${threshold}s`}
          state="idle"
          status={`${(threshold / 60).toFixed(1)} minutes`}
        />
      </div>

      <Panel className="print-area">
        <PanelHeader title={`Employees · ${rows.length}`} />
        {rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-text-muted">
            No active employees.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Consent</th>
                  <th className="px-4 py-3 font-medium">Agent last seen</th>
                  <th className="px-4 py-3 font-medium">Today</th>
                  <th className="px-4 py-3 font-medium">This month</th>
                  <th className="px-4 py-3 text-right font-medium print:hidden">Token</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const fresh = r.agent ? agentFreshness(r.agent.lastSeenAt) : null;
                  // Consent gone → the data on screen is historical, not live.
                  const paused = !r.consent.active;
                  return (
                    <tr key={r.employeeId} className="hover:bg-surface-raised/50">
                      <td className="px-4 py-3">
                        <div className="text-text">{r.name}</div>
                        <div className="font-mono text-[11px] text-text-muted">
                          {r.employeeCode} · {r.department}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2">
                          <StatusDot state={r.consent.active ? "good" : "warn"} />
                          <span
                            className={`text-xs ${paused ? "text-warn" : "text-text-muted"}`}
                          >
                            {consentLabel(r.consent)}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {!r.agent || !r.agent.active ? (
                          <span className="text-xs text-text-muted">no agent</span>
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            <StatusDot state={fresh!.state} />
                            <span className="font-mono text-xs text-text-muted">
                              {fresh!.label}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {r.today.totalMinutes === 0 ? (
                          <span className="text-text-muted">—</span>
                        ) : (
                          <>
                            <span className="text-text">{r.today.activePct}% active</span>
                            <span className="ml-1.5 text-text-muted">
                              ({hm(r.today.activeMinutes)} / {hm(r.today.totalMinutes)})
                            </span>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {r.month.totalMinutes === 0 ? (
                          <span className="text-text-muted">—</span>
                        ) : (
                          <>
                            <span className="text-text">{r.month.activePct}% active</span>
                            <span className="ml-1.5 text-text-muted">
                              ({hm(r.month.activeMinutes)} / {hm(r.month.totalMinutes)})
                            </span>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 print:hidden">
                        <AgentTokenManager
                          employeeId={r.employeeId}
                          name={r.name}
                          hasActiveToken={Boolean(r.agent?.active)}
                          consentActive={r.consent.active}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-border px-4 py-3 text-xs text-text-muted">
          <MonitorSmartphone size={12} className="mr-1 inline" />
          An employee whose consent is not active shows &quot;tracking
          paused&quot; — any totals beside it are historical, not current. The
          server rejects new heartbeats for them.
        </p>
      </Panel>
    </>
  );
}
