import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader, StatCard } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { RetentionActions } from "@/components/hr/retention-actions";
import { db } from "@/lib/db";
import {
  RETENTION_DAYS_NO_CONSENT,
  RETENTION_DAYS_WITH_CONSENT,
} from "@/lib/recruitment/retention";

export const dynamic = "force-dynamic";

function ymd(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

function daysAgo(d: Date, now: Date): number {
  return Math.floor((now.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
}

async function load() {
  const now = new Date();
  try {
    // Two queries: those DUE now, and those scheduled but not yet due (shown
    // for visibility so the policy is legible, not just enforced).
    // Applications counted by relation — no per-candidate lookup.
    const [due, upcoming, consented] = await Promise.all([
      db.candidate.findMany({
        where: { scheduledDeletionAt: { not: null, lte: now } },
        include: {
          _count: { select: { applications: true } },
          applications: {
            select: {
              stage: true,
              jobRequisition: { select: { title: true } },
            },
          },
        },
        orderBy: { scheduledDeletionAt: "asc" },
        take: 200,
      }),
      db.candidate.findMany({
        where: { scheduledDeletionAt: { not: null, gt: now } },
        select: {
          id: true,
          name: true,
          email: true,
          talentPoolConsent: true,
          scheduledDeletionAt: true,
        },
        orderBy: { scheduledDeletionAt: "asc" },
        take: 50,
      }),
      db.candidate.count({ where: { talentPoolConsent: true } }),
    ]);
    return { due, upcoming, consented, now, error: null };
  } catch (err) {
    console.error("[hr/retention-review] failed:", err);
    return {
      due: [],
      upcoming: [],
      consented: 0,
      now,
      error: "Retention data is unavailable right now.",
    };
  }
}

export default async function RetentionReviewPage() {
  const { due, upcoming, consented, now, error } = await load();

  return (
    <>
      <Link
        href="/hr/candidates"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text"
      >
        <ArrowLeft size={13} /> Back to pipeline
      </Link>

      <PageHeader
        title="Candidates Due for Review"
        description="Unsuccessful candidates whose retention window has elapsed. Nothing is deleted automatically — you decide, because a purge cannot be undone and may destroy data needed for a live matter."
      />

      {error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{error}</span>
        </Panel>
      )}

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Due for Review"
          value={due.length}
          state={due.length > 0 ? "warn" : "good"}
          status={due.length === 0 ? "Nothing outstanding" : "Action required"}
        />
        <StatCard
          label="Scheduled, Not Yet Due"
          value={upcoming.length}
          state="idle"
          status="Retention clock running"
        />
        <StatCard
          label="Talent-Pool Consented"
          value={consented}
          state="idle"
          status={`${RETENTION_DAYS_WITH_CONSENT / 365}-year window`}
        />
      </div>

      <Panel className="mb-5 px-4 py-3">
        <div className="flex items-start gap-3">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-text-muted" />
          <div className="text-xs text-text-muted">
            <p className="text-text">Retention policy</p>
            <p className="mt-1">
              Rejected without talent-pool consent — reviewed after{" "}
              {RETENTION_DAYS_NO_CONSENT} days. Rejected with consent — reviewed
              after {RETENTION_DAYS_WITH_CONSENT} days; consent extends the
              window but does not make it indefinite. Hired candidates are never
              scheduled: their record becomes employment history under a
              different lawful basis.
            </p>
          </div>
        </div>
      </Panel>

      <Panel className="mb-6">
        <PanelHeader title={`Due for Review · ${due.length}`} />
        {due.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-10 text-sm text-text-muted">
            <StatusDot state="good" /> No candidate data is past its retention
            window.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {due.map((c) => {
              const overdue = daysAgo(c.scheduledDeletionAt!, now);
              const hired = c.applications.some((a) => a.stage === "HIRED");
              return (
                <li key={c.id} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-text">
                      <StatusDot state={hired ? "idle" : "warn"} />
                      <span className="font-medium">{c.name}</span>
                      {c.talentPoolConsent && (
                        <span className="rounded border border-accent/40 px-1.5 py-0.5 text-[10px] uppercase text-accent">
                          talent pool
                        </span>
                      )}
                      {hired && (
                        <span className="rounded border border-good/40 px-1.5 py-0.5 text-[10px] uppercase text-good">
                          hired — retained
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-text-muted">
                      {c.email} · {c.phone}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-text-muted">
                      due {ymd(c.scheduledDeletionAt)} ({overdue} day
                      {overdue === 1 ? "" : "s"} ago) · {c._count.applications}{" "}
                      application{c._count.applications === 1 ? "" : "s"} ·
                      applied {ymd(c.createdAt)}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {c.applications.map((a, i) => (
                        <span
                          key={i}
                          className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-text-muted"
                        >
                          {a.jobRequisition.title} · {a.stage}
                        </span>
                      ))}
                    </div>
                  </div>
                  <RetentionActions
                    candidateId={c.id}
                    name={c.name}
                    applications={c._count.applications}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHeader title={`Scheduled — Not Yet Due · ${upcoming.length}`} />
        {upcoming.length === 0 ? (
          <div className="px-4 py-8 text-sm text-text-muted">
            No candidates currently have a retention clock running.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {upcoming.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
              >
                <span className="min-w-0 truncate">
                  <span className="text-text">{c.name}</span>
                  <span className="ml-2 text-xs text-text-muted">{c.email}</span>
                  {c.talentPoolConsent && (
                    <span className="ml-2 rounded border border-accent/40 px-1.5 py-0.5 text-[10px] uppercase text-accent">
                      talent pool
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-xs text-text-muted">
                  review {ymd(c.scheduledDeletionAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
