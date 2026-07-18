import { auth } from "@clerk/nextjs/server";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { AcknowledgeButton } from "@/components/employee/acknowledge-button";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";

export const dynamic = "force-dynamic";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function load() {
  const { userId } = await auth();
  if (!userId) return { employee: null, error: null };
  try {
    const employee = await getEmployeeByClerkId(userId);
    if (!employee) return { employee: null, error: null };
    // ONLY released letters for this employee — drafts are never queried here.
    const letters = await db.warningLetter.findMany({
      where: { employeeId: employee.id, status: "RELEASED" },
      orderBy: { releasedAt: "desc" },
    });
    return { employee, error: null, letters };
  } catch (err) {
    console.error("[employee/documents] failed:", err);
    return { employee: null, error: "Documents are unavailable right now." };
  }
}

export default async function MyDocumentsPage() {
  const data = await load();

  return (
    <>
      <PageHeader
        title="My Documents"
        description="Warning letters that have been formally released to you."
      />

      {data.error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{data.error}</span>
        </Panel>
      )}

      {!data.employee && !data.error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="warn" />
          <span className="text-sm text-text-muted">No employee record is linked to your account yet.</span>
        </Panel>
      )}

      {data.employee && (
        <Panel>
          <PanelHeader title="Warning Letters" />
          {data.letters.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <StatusDot state="good" />
              <p className="text-sm text-text">No warning letters on record</p>
              <p className="text-xs text-text-muted">Only letters formally released by HR appear here.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {data.letters.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm text-text">{l.reason}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-text-muted">
                      released {l.releasedAt ? ymd(l.releasedAt) : "—"}
                    </p>
                    {l.fileUrl && (
                      <a href={l.fileUrl} className="mt-0.5 inline-block text-xs text-info underline" target="_blank" rel="noreferrer">
                        View attachment
                      </a>
                    )}
                  </div>
                  {l.acknowledged ? (
                    <span className="inline-flex shrink-0 items-center gap-2 text-xs">
                      <StatusDot state="good" />
                      <span className="text-text-muted">Acknowledged</span>
                    </span>
                  ) : (
                    <AcknowledgeButton id={l.id} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </>
  );
}
