import { getEffectiveUserId } from "@/lib/auth";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { CycleCreateForm } from "@/components/hr/cycle-create-form";
import { CycleActions } from "@/components/hr/cycle-actions";
import { db } from "@/lib/db";
import { PrintButton } from "@/components/ui/print-button";

export const dynamic = "force-dynamic";

async function load() {
  const userId = await getEffectiveUserId();
  if (!userId) return { cycles: null, error: null };
  try {
    const cycles = await db.appraisalCycle.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { scores: true } } },
    });
    return { cycles, error: null };
  } catch (err) {
    console.error("[hr/appraisal] failed:", err);
    return { cycles: null, error: "Appraisal cycles are unavailable right now." };
  }
}

export default async function AppraisalCyclesPage() {
  const { cycles, error } = await load();

  return (
    <>
      <PageHeader
        title="Appraisal Cycles"
        description="Create cycles, compute scores from the snapshotted formula, and publish. HR cannot edit formula weights."
        action={<PrintButton label="Print results" />}
      />

      {error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{error}</span>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="New Cycle" />
          <div className="p-4">
            <CycleCreateForm />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Cycles" />
          {!cycles || cycles.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <StatusDot state="idle" />
              <p className="text-sm text-text">No cycles yet</p>
              <p className="text-xs text-text-muted">Create a cycle to begin.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {cycles.map((c) => (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm text-text">
                        <span className="font-mono">{c.period}</span>
                        <span className="text-text-muted">
                          · {c.department ?? "Org-wide"}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-text-muted">
                        {c._count.scores} score rows
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-2 text-xs">
                      <StatusDot state={c.published ? "good" : "warn"} />
                      <span className="text-text-muted">
                        {c.published ? "Published" : "In progress"}
                      </span>
                    </span>
                  </div>
                  {!c.published && <CycleActions cycleId={c.id} />}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
