import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { ConsentForm } from "@/components/hr/consent-form";
import { db } from "@/lib/db";
import { getActiveEmployees } from "@/lib/data/scope";

export const dynamic = "force-dynamic";

const TYPES = ["FACE_VERIFICATION", "IDLE_TRACKING"] as const;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function load() {
  try {
    // Two queries; consent status joined in memory (no per-employee lookups).
    const [employees, records] = await Promise.all([
      getActiveEmployees(),
      db.consentRecord.findMany({ orderBy: { givenOn: "desc" } }),
    ]);
    // Latest record per (employeeId, consentType) — records already newest-first.
    const latest = new Map<string, (typeof records)[number]>();
    for (const r of records) {
      const key = `${r.employeeId}|${r.consentType}`;
      if (!latest.has(key)) latest.set(key, r);
    }
    return { employees, latest, error: null };
  } catch (err) {
    console.error("[hr/compliance] failed:", err);
    return { employees: [], latest: new Map(), error: "Compliance data is unavailable right now." };
  }
}

export default async function CompliancePage() {
  const { employees, latest, error } = await load();
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Compliance & Consent"
        description="Record and track employee consent for face verification and idle tracking."
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
          <PanelHeader title="Consent Status" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Face Verification</th>
                  <th className="px-4 py-3 font-medium">Idle Tracking</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {employees.map((e) => (
                  <tr key={e.id}>
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
                  </tr>
                ))}
                {employees.length === 0 && !error && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-text-muted">No active employees.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
