import { getEffectiveUserId } from "@/lib/auth";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { WarningIssueForm } from "@/components/manager/warning-issue-form";
import { db } from "@/lib/db";
import { getEmployeeByClerkId, getDirectReports } from "@/lib/data/scope";
import { ErrorPanel, UnlinkedEmployeeNotice } from "@/components/ui/notice";

export const dynamic = "force-dynamic";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function load() {
  const userId = await getEffectiveUserId();
  if (!userId) return { manager: null, error: null };
  try {
    const manager = await getEmployeeByClerkId(userId);
    if (!manager) return { manager: null, error: null };
    const [reports, letters] = await Promise.all([
      getDirectReports(manager.id),
      db.warningLetter.findMany({
        where: { issuedBy: userId },
        include: { employee: { select: { name: true, employeeCode: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return { manager, error: null, reports, letters };
  } catch (err) {
    console.error("[manager/warnings] failed:", err);
    return { manager: null, error: "Warning letters are unavailable right now." };
  }
}

export default async function ManagerWarningsPage() {
  const data = await load();

  return (
    <>
      <PageHeader
        title="Warning Letters"
        description="Draft warning letters for your direct reports. Only HR can release a draft to the employee."
      />

      {data.error && (
        <ErrorPanel>{data.error}</ErrorPanel>
      )}

      {!data.manager && !data.error && (
        <UnlinkedEmployeeNotice />
      )}

      {data.manager && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="New Draft" />
            <div className="p-4">
              <WarningIssueForm
                reports={data.reports.map((r) => ({ id: r.id, name: r.name, employeeCode: r.employeeCode }))}
              />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Issued by Me" />
            {data.letters.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <StatusDot state="idle" />
                <p className="text-sm text-text">No warning letters issued</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {data.letters.map((l) => (
                  <li key={l.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm text-text">
                          <span>{l.employee.name}</span>
                          <span className="font-mono text-xs text-text-muted">{l.employee.employeeCode}</span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-text-muted">{l.reason}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-text-muted">{ymd(l.createdAt)}</p>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-2 text-xs">
                        <StatusDot state={l.status === "RELEASED" ? "good" : "warn"} />
                        <span className="text-text-muted">{l.status}</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
