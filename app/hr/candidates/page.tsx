import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { PipelineStage } from "@prisma/client";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot, type StatusState } from "@/components/ui/status-dot";
import { StageMoveButtons } from "@/components/hr/stage-move-buttons";
import { db } from "@/lib/db";
import { resolveRecruitmentScope } from "@/lib/recruitment/access";
import { ErrorPanel } from "@/components/ui/notice";

export const dynamic = "force-dynamic";

const STAGE_ORDER: PipelineStage[] = [
  "APPLIED",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
];

const STAGE_DOT: Record<PipelineStage, StatusState> = {
  APPLIED: "idle",
  SCREENING: "idle",
  INTERVIEW: "warn",
  OFFER: "warn",
  HIRED: "good",
  REJECTED: "danger",
};

async function load() {
  const scope = await resolveRecruitmentScope();
  if (!scope.ok) return { scope, applications: [], dueForReview: 0, error: null };
  try {
    // ONE query for the whole board: candidate + requisition joined, feedback
    // counted by relation. Adding candidates does not add queries.
    const applications = await db.application.findMany({
      where: scope.isPrivileged
        ? {}
        : { jobRequisition: { department: scope.department } },
      include: {
        candidate: { select: { id: true, name: true, email: true, phone: true } },
        jobRequisition: { select: { id: true, title: true, department: true, status: true } },
        offer: { select: { id: true, status: true } },
        _count: { select: { interviewFeedback: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 400,
    });
    // Count of candidates past their retention review date — a badge, so the
    // compliance queue is visible rather than needing to be remembered.
    const dueForReview = scope.isPrivileged
      ? await db.candidate.count({
          where: { scheduledDeletionAt: { not: null, lte: new Date() } },
        })
      : 0;

    return { scope, applications, dueForReview, error: null };
  } catch (err) {
    console.error("[hr/candidates] failed:", err);
    return {
      scope,
      applications: [],
      dueForReview: 0,
      error: "Candidate data is unavailable right now.",
    };
  }
}

export default async function CandidatesPage() {
  const { scope, applications, dueForReview, error } = await load();

  if (!scope.ok) {
    return (
      <>
        <PageHeader title="Candidates" />
        <Panel className="flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{scope.message}</span>
        </Panel>
      </>
    );
  }

  // A Manager reaches this same component under /manager/candidates, and
  // middleware blocks them from /hr/* — so links must point at their own
  // portal, not HR's.
  const basePath = scope.isPrivileged ? "/hr/candidates" : "/manager/candidates";

  const byStage = new Map<PipelineStage, typeof applications>();
  for (const a of applications) {
    const arr = byStage.get(a.stage) ?? [];
    arr.push(a);
    byStage.set(a.stage, arr);
  }

  return (
    <>
      <PageHeader
        title="Candidate Pipeline"
        description={
          scope.isPrivileged
            ? "Every application across all requisitions. Move candidates through the pipeline; rejecting requires a recorded reason."
            : `Candidates for ${scope.department} roles only. You can review resumes and add interview feedback — HR drives the pipeline.`
        }
        action={
          scope.isPrivileged ? (
            <Link
              href="/hr/candidates/retention-review"
              className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ShieldCheck size={13} />
              Retention review
              {dueForReview > 0 && (
                <span className="rounded bg-warn/20 px-1.5 py-0.5 font-mono text-[10px] text-warn">
                  {dueForReview}
                </span>
              )}
            </Link>
          ) : undefined
        }
      />

      {error && (
        <ErrorPanel>{error}</ErrorPanel>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        {STAGE_ORDER.map((s) => (
          <span
            key={s}
            className="inline-flex items-center gap-2 rounded border border-border bg-surface px-2.5 py-1 text-xs"
          >
            <StatusDot state={STAGE_DOT[s]} />
            <span className="text-text-muted">{s}</span>
            <span className="font-mono text-text">{byStage.get(s)?.length ?? 0}</span>
          </span>
        ))}
      </div>

      {applications.length === 0 ? (
        <Panel className="px-4 py-12 text-center text-sm text-text-muted">
          No applications yet.
        </Panel>
      ) : (
        <div className="space-y-6">
          {STAGE_ORDER.map((s) => {
            const list = byStage.get(s) ?? [];
            if (list.length === 0) return null;
            return (
              <Panel key={s}>
                <PanelHeader title={`${s} · ${list.length}`} />
                <ul className="divide-y divide-border">
                  {list.map((a) => (
                    <li key={a.id} className="flex items-start justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm text-text">
                          <StatusDot state={STAGE_DOT[a.stage]} />
                          <Link
                            href={`${basePath}/${a.id}`}
                            className="font-medium hover:text-accent hover:underline"
                          >
                            {a.candidate.name}
                          </Link>
                          {a.offer && (
                            <span className="rounded border border-accent/40 px-1.5 py-0.5 text-[10px] uppercase text-accent">
                              offer {a.offer.status}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-text-muted">
                          {a.jobRequisition.title} · {a.jobRequisition.department}
                          {a._count.interviewFeedback > 0 &&
                            ` · ${a._count.interviewFeedback} feedback`}
                        </div>
                        <div className="mt-0.5 text-[11px] text-text-muted">
                          {a.candidate.email} · {a.candidate.phone}
                        </div>
                        {a.stage === "REJECTED" && a.rejectedReason && (
                          <p className="mt-1 text-[11px] text-danger">
                            Reason: {a.rejectedReason}
                          </p>
                        )}
                      </div>
                      {scope.isPrivileged && <StageMoveButtons id={a.id} stage={a.stage} />}
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
