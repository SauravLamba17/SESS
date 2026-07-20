import { getEffectiveUserId } from "@/lib/auth";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { ClientMailForm } from "@/components/manager/client-mail-form";
import { db } from "@/lib/db";
import { getEmployeeByClerkId, getDirectReports } from "@/lib/data/scope";

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
    const reports = await getDirectReports(manager.id);
    const ids = reports.map((r) => r.id);
    // Mails for this manager's direct reports — one query with an include.
    const mails = ids.length
      ? await db.clientMail.findMany({
          where: { employeeId: { in: ids } },
          include: { employee: { select: { name: true, employeeCode: true } } },
          orderBy: { date: "desc" },
          take: 50,
        })
      : [];
    return { manager, error: null, reports, mails };
  } catch (err) {
    console.error("[manager/client-mail] failed:", err);
    return { manager: null, error: "Client mail is unavailable right now." };
  }
}

export default async function ClientMailPage() {
  const data = await load();

  return (
    <>
      <PageHeader
        title="Client Mail Log"
        description="Tag client emails to a direct report and keep a running log."
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
          <span className="text-sm text-text-muted">No employee record is linked to your account yet.</span>
        </Panel>
      )}

      {data.manager && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="Tag Client Mail" />
            <div className="p-4">
              <ClientMailForm reports={data.reports.map((r) => ({ id: r.id, name: r.name, employeeCode: r.employeeCode }))} />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Recent" />
            {data.mails.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <StatusDot state="idle" />
                <p className="text-sm text-text">No client mail tagged yet</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {data.mails.map((m) => (
                  <li key={m.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm text-text">{m.subject}</span>
                      <span className="shrink-0 font-mono text-[11px] text-text-muted">{ymd(m.date)}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-text-muted">
                      {m.employee.name} · {m.employee.employeeCode}
                    </div>
                    {m.summary && (
                      <p className="mt-1 text-xs text-text-muted">{m.summary}</p>
                    )}
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
