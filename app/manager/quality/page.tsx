import { getEffectiveUserId } from "@/lib/auth";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel } from "@/components/ui/panel";
import { StatusDot, type StatusState } from "@/components/ui/status-dot";
import { QualityForm } from "@/components/manager/quality-form";
import { db } from "@/lib/db";
import { getEmployeeByClerkId, getDirectReports } from "@/lib/data/scope";
import { currentPeriod } from "@/lib/period";

export const dynamic = "force-dynamic";

function scoreState(score: number): StatusState {
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

    // One query for all reports' quality this month (ordered newest first).
    const quality = await db.qualityReport.findMany({
      where: { employeeId: { in: ids }, date: { gte: monthStart, lt: monthEnd } },
      orderBy: { date: "desc" },
    });

    // First row per employee is the latest (already sorted desc).
    const latestByEmp = new Map<string, (typeof quality)[number]>();
    for (const q of quality) if (!latestByEmp.has(q.employeeId)) latestByEmp.set(q.employeeId, q);

    return { manager, error: null, period, reports, latestByEmp };
  } catch (err) {
    console.error("[manager/quality] failed:", err);
    return { manager: null, error: "Quality data is unavailable right now." };
  }
}

export default async function TeamQualityPage() {
  const data = await load();

  return (
    <>
      <PageHeader
        title="Team Quality"
        description="Log defect counts and quality scores for your direct reports — one review per employee per day."
      />

      {data.error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{data.error}</span>
        </Panel>
      )}

      {!data.manager && !data.error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="warn" />
          <span className="text-sm text-text-muted">
            No employee record is linked to your account yet.
          </span>
        </Panel>
      )}

      {data.manager && (
        <Panel>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-text">Direct Reports</h3>
            <span className="font-mono text-xs text-text-muted">{data.period}</span>
          </div>
          <ul className="divide-y divide-border">
            {data.reports.map((r) => {
              const latest = data.latestByEmp.get(r.id);
              return (
                <li key={r.id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm text-text">{r.name}</div>
                    <div className="flex items-center gap-2 font-mono text-xs text-text-muted">
                      <span>{r.employeeCode}</span>
                      {latest ? (
                        <span className="inline-flex items-center gap-1.5">
                          <StatusDot state={scoreState(latest.qualityScore)} />
                          latest {latest.qualityScore.toFixed(1)} · {latest.defectCount} def
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <StatusDot state="idle" /> no reviews this month
                        </span>
                      )}
                    </div>
                  </div>
                  <QualityForm employeeId={r.id} />
                </li>
              );
            })}
            {data.reports.length === 0 && (
              <li className="px-4 py-8 text-sm text-text-muted">No direct reports.</li>
            )}
          </ul>
        </Panel>
      )}
    </>
  );
}
