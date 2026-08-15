import { getEffectiveUserId } from "@/lib/auth";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel } from "@/components/ui/panel";
import { StatusDot, type StatusState } from "@/components/ui/status-dot";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { ErrorPanel, UnlinkedEmployeeNotice } from "@/components/ui/notice";
import { ymd } from "@/lib/reports/range";

export const dynamic = "force-dynamic";

function scoreState(score: number): StatusState {
  if (score >= 90) return "good";
  if (score >= 75) return "warn";
  return "danger";
}

async function load() {
  const userId = await getEffectiveUserId();
  if (!userId) return { employee: null, error: null };
  try {
    const employee = await getEmployeeByClerkId(userId);
    if (!employee) return { employee: null, error: null };
    const reports = await db.qualityReport.findMany({
      where: { employeeId: employee.id },
      orderBy: { date: "desc" },
      take: 60,
    });
    return { employee, error: null, reports };
  } catch (err) {
    console.error("[employee/quality] failed:", err);
    return { employee: null, error: "Quality data is unavailable right now." };
  }
}

export default async function MyQualityPage() {
  const data = await load();

  return (
    <>
      <PageHeader
        title="My Quality"
        description="Defect counts and quality scores from reviews of your work."
      />

      {data.error && (
        <ErrorPanel>{data.error}</ErrorPanel>
      )}

      {!data.employee && !data.error && (
        <UnlinkedEmployeeNotice />
      )}

      {data.employee && (
        <Panel>
          {data.reports.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <StatusDot state="idle" />
              <p className="text-sm text-text">No quality reviews recorded yet</p>
              <p className="text-xs text-text-muted">
                Reviews logged by your manager will appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Defects</th>
                    <th className="px-4 py-3 font-medium">Score</th>
                    <th className="px-4 py-3 font-medium">Reviewed By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.reports.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 font-mono text-text-muted">
                        {ymd(r.date)}
                      </td>
                      <td className="px-4 py-3 font-mono text-text">
                        {r.defectCount}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2">
                          <StatusDot state={scoreState(r.qualityScore)} />
                          <span className="font-mono text-text">
                            {r.qualityScore.toFixed(1)}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-text-muted">
                        {r.reviewedBy ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
