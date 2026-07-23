import Link from "next/link";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { ConsentForm } from "@/components/hr/consent-form";
import { AgentTokenManager } from "@/components/hr/agent-token-manager";
import { db } from "@/lib/db";
import { getActiveEmployees } from "@/lib/data/scope";
import { idleConsentStates, consentLabel } from "@/lib/idle/consent";

export const dynamic = "force-dynamic";

const TYPES = ["FACE_VERIFICATION", "IDLE_TRACKING"] as const;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function load() {
  try {
    // Three queries; consent status and token state joined in memory. Adding
    // employees adds rows to these results, not queries — no N+1.
    const [employees, records, tokens] = await Promise.all([
      getActiveEmployees(),
      db.consentRecord.findMany({ orderBy: { givenOn: "desc" } }),
      db.agentToken.findMany({
        select: { employeeId: true, active: true, lastSeenAt: true },
      }),
    ]);
    // Latest record per (employeeId, consentType) — records already newest-first.
    const latest = new Map<string, (typeof records)[number]>();
    for (const r of records) {
      const key = `${r.employeeId}|${r.consentType}`;
      if (!latest.has(key)) latest.set(key, r);
    }
    const tokenBy = new Map(tokens.map((t) => [t.employeeId, t]));

    // The SAME resolver the token-issue route and the heartbeat endpoint use,
    // so what this page shows can never disagree with what the server enforces.
    const idleConsent = await idleConsentStates(
      db,
      employees.map((e) => e.id),
    );

    return { employees, latest, tokenBy, idleConsent, error: null };
  } catch (err) {
    console.error("[hr/compliance] failed:", err);
    return {
      employees: [],
      latest: new Map(),
      tokenBy: new Map(),
      idleConsent: new Map(),
      error: "Compliance data is unavailable right now.",
    };
  }
}

export default async function CompliancePage() {
  const { employees, latest, tokenBy, idleConsent, error } = await load();
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Compliance & Consent"
        description="Record and track employee consent for face verification and idle tracking — and issue the desktop agent token from the same place."
        action={
          <Link
            href="/hr/idle-tracking"
            className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            View idle-tracking data →
          </Link>
        }
      />

      {error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{error}</span>
        </Panel>
      )}

      <div className="space-y-6">
        <Panel>
          <PanelHeader title="Record Consent" />
          <div className="p-4">
            <ConsentForm employees={employees.map((e) => ({ id: e.id, name: e.name, employeeCode: e.employeeCode }))} />
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Consent Status"
            action={
              <span className="text-xs text-text-muted">
                Agent tokens are issued here — no need to leave this page
              </span>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Face Verification</th>
                  <th className="px-4 py-3 font-medium">Idle Tracking</th>
                  <th className="px-4 py-3 font-medium">Agent Token</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {employees.map((e) => {
                  const idle = idleConsent.get(e.id);
                  const tok = tokenBy.get(e.id);
                  return (
                    <tr key={e.id} className="align-top">
                      <td className="px-4 py-3">
                        <div className="text-text">{e.name}</div>
                        <div className="font-mono text-xs text-text-muted">{e.employeeCode}</div>
                      </td>
                      {TYPES.map((t) => {
                        const rec = latest.get(`${e.id}|${t}`);
                        const expired = rec?.retentionExpiry ? rec.retentionExpiry < now : false;
                        return (
                          <td key={t} className="px-4 py-3">
                            {rec ? (
                              <span className="inline-flex items-center gap-2">
                                <StatusDot state={expired ? "danger" : "good"} />
                                <span className="font-mono text-xs text-text-muted">
                                  {ymd(rec.givenOn)}
                                  {rec.retentionExpiry ? ` → ${ymd(rec.retentionExpiry)}${expired ? " (expired)" : ""}` : ""}
                                </span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-2">
                                <StatusDot state="idle" />
                                <span className="text-xs text-text-muted">Not on file</span>
                              </span>
                            )}
                          </td>
                        );
                      })}
                      {/* Inline token control — the whole point of this change.
                          Gated on the SAME consent state the server enforces. */}
                      <td className="min-w-[16rem] px-4 py-3">
                        <AgentTokenManager
                          employeeId={e.id}
                          name={e.name}
                          hasActiveToken={Boolean(tok?.active)}
                          consentActive={Boolean(idle?.active)}
                          lastSeenAt={tok?.lastSeenAt ? tok.lastSeenAt.toISOString() : null}
                          consentHint={
                            idle && !idle.active
                              ? `${consentLabel(idle)} — record idle-tracking consent above first.`
                              : undefined
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
                {employees.length === 0 && !error && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-text-muted">No active employees.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-4 py-3 text-xs text-text-muted">
            A token can only be issued while idle-tracking consent is active —
            the same rule the server enforces on every heartbeat. Revoking
            consent stops tracking regardless of whether a token still exists.
          </p>
        </Panel>
      </div>
    </>
  );
}
