import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { RequisitionForm } from "@/components/hr/requisition-form";
import { RequisitionStatusButton } from "@/components/hr/requisition-status-button";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const DOT = { OPEN: "good", ON_HOLD: "warn", CLOSED: "idle" } as const;

async function load() {
  try {
    // Application counts come from a relation _count — one query, no per-row
    // lookups as the number of requisitions grows.
    const requisitions = await db.jobRequisition.findMany({
      include: { _count: { select: { applications: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    return { requisitions, error: null };
  } catch (err) {
    console.error("[hr/requisitions] failed:", err);
    return { requisitions: [], error: "Requisitions are unavailable right now." };
  }
}

export default async function RequisitionsPage() {
  const { requisitions, error } = await load();
  const open = requisitions.filter((r) => r.status === "OPEN").length;

  return (
    <>
      <PageHeader
        title="Job Requisitions"
        description="Open roles are published on the public career page. Closing a requisition removes it from that page and rejects further applications."
        action={
          <Link
            href="/careers"
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text"
          >
            <ExternalLink size={13} /> View public career page
          </Link>
        }
      />

      {error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{error}</span>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Panel>
            <PanelHeader title="New Requisition" />
            <div className="p-4">
              <RequisitionForm />
            </div>
          </Panel>
        </div>

        <div className="lg:col-span-3">
          <Panel>
            <PanelHeader
              title={`Requisitions · ${requisitions.length}`}
              action={
                <span className="font-mono text-xs text-text-muted">{open} open</span>
              }
            />
            {requisitions.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-text-muted">
                No requisitions yet — create one to start hiring.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {requisitions.map((r) => (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm text-text">
                          <StatusDot state={DOT[r.status]} />
                          <span className="font-medium">{r.title}</span>
                          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-text-muted">
                            {r.status}
                          </span>
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-text-muted">
                          {r.department} · {r.openings} opening
                          {r.openings === 1 ? "" : "s"} · {r._count.applications}{" "}
                          application{r._count.applications === 1 ? "" : "s"}
                          {r.closedAt &&
                            ` · closed ${r.closedAt.toISOString().slice(0, 10)}`}
                        </div>
                      </div>
                      <RequisitionStatusButton id={r.id} status={r.status} title={r.title} />
                    </div>

                    {r.status !== "CLOSED" && (
                      <details className="mt-2 rounded border border-border bg-surface-raised/40">
                        <summary className="cursor-pointer px-3 py-1.5 text-xs text-text-muted">
                          Edit
                        </summary>
                        <div className="p-3">
                          <RequisitionForm
                            initial={{
                              id: r.id,
                              title: r.title,
                              department: r.department,
                              description: r.description,
                              openings: r.openings,
                            }}
                          />
                        </div>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
