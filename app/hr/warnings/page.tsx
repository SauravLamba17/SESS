import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { ReleaseButton } from "@/components/hr/release-button";
import { db } from "@/lib/db";
import { ErrorPanel } from "@/components/ui/notice";
import { ymd } from "@/lib/reports/range";

export const dynamic = "force-dynamic";

async function load() {
  try {
    // Two queries, each with an employee include — no per-row lookups.
    const [drafts, released] = await Promise.all([
      db.warningLetter.findMany({
        where: { status: "DRAFT" },
        include: { employee: { select: { name: true, employeeCode: true } } },
        orderBy: { createdAt: "asc" },
      }),
      db.warningLetter.findMany({
        where: { status: "RELEASED" },
        include: { employee: { select: { name: true, employeeCode: true } } },
        orderBy: { releasedAt: "desc" },
        take: 30,
      }),
    ]);
    return { drafts, released, error: null };
  } catch (err) {
    console.error("[hr/warnings] failed:", err);
    return { drafts: [], released: [], error: "Warning letters are unavailable right now." };
  }
}

export default async function HRWarningsPage() {
  const { drafts, released, error } = await load();

  return (
    <>
      <PageHeader
        title="Warning Letters"
        description="Release drafted warning letters to employees. Release is HR-only and irreversible."
      />

      {error && (
        <ErrorPanel>{error}</ErrorPanel>
      )}

      <div className="space-y-6">
        <Panel>
          <PanelHeader title={`Awaiting Release · ${drafts.length}`} />
          {drafts.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-8 text-sm text-text-muted">
              <StatusDot state="good" /> No drafts awaiting release.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {drafts.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm text-text">
                      <span>{l.employee.name}</span>
                      <span className="font-mono text-xs text-text-muted">{l.employee.employeeCode}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">{l.reason}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-text-muted">drafted {ymd(l.createdAt)}</p>
                  </div>
                  <ReleaseButton id={l.id} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Released History" />
          {released.length === 0 ? (
            <div className="px-4 py-8 text-sm text-text-muted">No released letters yet.</div>
          ) : (
            <ul className="divide-y divide-border">
              {released.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div>
                    <span className="text-text">{l.employee.name}</span>
                    <span className="ml-2 font-mono text-xs text-text-muted">{l.employee.employeeCode}</span>
                  </div>
                  <span className="inline-flex items-center gap-2 text-xs">
                    <StatusDot state={l.acknowledged ? "good" : "warn"} />
                    <span className="text-text-muted">
                      {l.acknowledged ? "Acknowledged" : "Released"}
                      {l.releasedAt ? ` · ${ymd(l.releasedAt)}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
