import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { StageMoveButtons } from "@/components/hr/stage-move-buttons";
import {
  InterviewFeedbackForm,
  ReviewNotesForm,
} from "@/components/hr/interview-feedback-form";
import { OfferPanel } from "@/components/hr/offer-panel";
import { db } from "@/lib/db";
import { resolveRecruitmentScope, canAccessApplication } from "@/lib/recruitment/access";

export const dynamic = "force-dynamic";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function CandidateDetailPage({
  params,
}: {
  params: { applicationId: string };
}) {
  const scope = await resolveRecruitmentScope();
  if (!scope.ok) {
    return (
      <>
        <PageHeader title="Candidate" />
        <Panel className="flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{scope.message}</span>
        </Panel>
      </>
    );
  }

  // Department scope is enforced here, before anything is rendered — a manager
  // following a link to another department's candidate gets refused, not a
  // partially-populated page.
  const access = await canAccessApplication(scope, params.applicationId);
  if (!access.ok) {
    if (access.code === "NOT_FOUND") notFound();
    return (
      <>
        <PageHeader title="Candidate" />
        <Panel className="flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{access.message}</span>
        </Panel>
      </>
    );
  }

  const [application, managers] = await Promise.all([
    db.application.findUnique({
      where: { id: params.applicationId },
      include: {
        candidate: true,
        jobRequisition: true,
        offer: true,
        // Ordered by round, then date — so the page reads as the process
        // actually happened rather than as a reverse-chronological jumble.
        interviewFeedback: {
          orderBy: [{ roundNumber: "asc" }, { interviewDate: "asc" }],
        },
      },
    }),
    scope.isPrivileged
      ? db.employee.findMany({
          where: { active: true },
          select: { id: true, name: true, employeeCode: true },
          orderBy: { employeeCode: "asc" },
        })
      : Promise.resolve([]),
  ]);

  if (!application) notFound();

  const avgRating =
    application.interviewFeedback.length > 0
      ? (
          application.interviewFeedback.reduce((s, f) => s + f.rating, 0) /
          application.interviewFeedback.length
        ).toFixed(1)
      : null;

  // Group feedback by interview round. Rows created before multi-round
  // tracking existed default to round 1, which is correct for them.
  const rounds = new Map<number, typeof application.interviewFeedback>();
  for (const f of application.interviewFeedback) {
    const arr = rounds.get(f.roundNumber) ?? [];
    arr.push(f);
    rounds.set(f.roundNumber, arr);
  }
  const roundNumbers = Array.from(rounds.keys()).sort((a, b) => a - b);
  // Pre-fill the form with the round HR is most likely entering next.
  const suggestedRound =
    roundNumbers.length === 0 ? 1 : Math.max(...roundNumbers) + 1;

  return (
    <>
      <Link
        href={scope.isPrivileged ? "/hr/candidates" : "/manager/candidates"}
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text"
      >
        <ArrowLeft size={13} /> Back to pipeline
      </Link>

      <PageHeader
        title={application.candidate.name}
        description={`${application.jobRequisition.title} · ${application.jobRequisition.department}`}
        action={scope.isPrivileged ? <StageMoveButtons id={application.id} stage={application.stage} /> : undefined}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel>
            <PanelHeader title="Resume" />
            <div className="p-4">
              <a
                href={`/api/resume/${application.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm text-text hover:bg-surface-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <FileText size={15} /> Open resume (PDF)
              </a>
              <p className="mt-2 text-[11px] text-text-muted">
                Read it yourself. SESS does not parse, extract or summarise
                resumes — no automated screening is applied to any applicant.
              </p>
              <object
                data={`/api/resume/${application.id}`}
                type="application/pdf"
                className="mt-4 h-[520px] w-full rounded border border-border"
              >
                <p className="p-4 text-xs text-text-muted">
                  Your browser cannot display the PDF inline —{" "}
                  <a
                    href={`/api/resume/${application.id}`}
                    className="text-accent underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    open it in a new tab
                  </a>
                  .
                </p>
              </object>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title={
                roundNumbers.length > 0
                  ? `Interview Feedback · ${roundNumbers.length} round${roundNumbers.length === 1 ? "" : "s"}`
                  : "Interview Feedback"
              }
              action={
                avgRating ? (
                  <span className="font-mono text-xs text-text-muted">
                    {application.interviewFeedback.length} entries · overall {avgRating}/5
                  </span>
                ) : undefined
              }
            />
            {roundNumbers.length > 0 && (
              <div className="divide-y divide-border">
                {roundNumbers.map((round) => {
                  const entries = rounds.get(round)!;
                  const roundAvg = (
                    entries.reduce((s, f) => s + f.rating, 0) / entries.length
                  ).toFixed(1);
                  // Round header shows its date range — "Round 2 — 22 Jan".
                  const dates = entries.map((e) => e.interviewDate.getTime());
                  const first = new Date(Math.min(...dates));
                  const last = new Date(Math.max(...dates));
                  const dateLabel =
                    ymd(first) === ymd(last) ? ymd(first) : `${ymd(first)} – ${ymd(last)}`;

                  return (
                    <div key={round}>
                      <div className="flex items-center justify-between gap-3 bg-surface-raised/40 px-4 py-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-text">
                          Round {round}
                          <span className="ml-2 font-mono font-normal normal-case text-text-muted">
                            {dateLabel}
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-2 text-[11px]">
                          <span className="text-text-muted">
                            {entries.length} interviewer
                            {entries.length === 1 ? "" : "s"}
                          </span>
                          <span className="font-mono text-text">avg {roundAvg}/5</span>
                        </span>
                      </div>
                      <ul className="divide-y divide-border">
                        {entries.map((f) => (
                          <li key={f.id} className="px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-mono text-xs text-text-muted">
                                {ymd(f.interviewDate)}
                              </span>
                              <span className="inline-flex items-center gap-2 text-xs">
                                <StatusDot
                                  state={
                                    f.rating >= 4 ? "good" : f.rating === 3 ? "warn" : "danger"
                                  }
                                />
                                <span className="font-mono text-text">{f.rating}/5</span>
                              </span>
                            </div>
                            <p className="mt-1 whitespace-pre-wrap text-sm text-text-muted">
                              {f.notes}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="border-t border-border p-4">
              <InterviewFeedbackForm
                applicationId={application.id}
                suggestedRound={suggestedRound}
              />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Review Notes" />
            <div className="p-4">
              <ReviewNotesForm
                applicationId={application.id}
                initial={application.reviewNotes ?? ""}
              />
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Candidate" />
            <dl className="divide-y divide-border text-sm">
              {(
                [
                  ["Stage", application.stage],
                  ["Email", application.candidate.email],
                  ["Phone", application.candidate.phone],
                  ["Source", application.candidate.source],
                  ["Applied", ymd(application.createdAt)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <dt className="text-text-muted">{k}</dt>
                  <dd className="truncate text-text">{v}</dd>
                </div>
              ))}
            </dl>
            {application.stage === "REJECTED" && application.rejectedReason && (
              <p className="border-t border-border px-4 py-3 text-xs text-danger">
                Rejected: {application.rejectedReason}
              </p>
            )}
          </Panel>

          {scope.isPrivileged && (
            <Panel>
              <PanelHeader title="Offer" />
              <div className="p-4">
                <OfferPanel
                  applicationId={application.id}
                  stage={application.stage}
                  defaultDepartment={application.jobRequisition.department}
                  candidateName={application.candidate.name}
                  managers={managers}
                  offer={
                    application.offer
                      ? {
                          id: application.offer.id,
                          status: application.offer.status,
                          proposedBasic: application.offer.proposedBasic.toFixed(2),
                          proposedHra: application.offer.proposedHra.toFixed(2),
                          proposedSpecialAllowance:
                            application.offer.proposedSpecialAllowance.toFixed(2),
                          proposedDesignation: application.offer.proposedDesignation,
                          proposedDepartment: application.offer.proposedDepartment,
                          proposedManagerId: application.offer.proposedManagerId,
                          joiningDate: ymd(application.offer.joiningDate),
                          approvedAt: application.offer.approvedAt
                            ? ymd(application.offer.approvedAt)
                            : null,
                          sentAt: application.offer.sentAt
                            ? ymd(application.offer.sentAt)
                            : null,
                          respondedAt: application.offer.respondedAt
                            ? ymd(application.offer.respondedAt)
                            : null,
                        }
                      : null
                  }
                />
              </div>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
