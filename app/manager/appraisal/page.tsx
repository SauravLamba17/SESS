import { auth } from "@clerk/nextjs/server";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { FeedbackForm } from "@/components/manager/feedback-form";
import { db } from "@/lib/db";
import { getEmployeeByClerkId, getDirectReports } from "@/lib/data/scope";

export const dynamic = "force-dynamic";

async function load() {
  const { userId } = await auth();
  if (!userId) return { manager: null, error: null };
  try {
    const manager = await getEmployeeByClerkId(userId);
    if (!manager) return { manager: null, error: null };

    const [reports, openCycles] = await Promise.all([
      getDirectReports(manager.id),
      db.appraisalCycle.findMany({
        where: { published: false },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const reportIds = reports.map((r) => r.id);
    const cycleIds = openCycles.map((c) => c.id);

    // Existing feedback for prefill (own reports, open cycles) — one query.
    const scores =
      reportIds.length && cycleIds.length
        ? await db.appraisalScore.findMany({
            where: { employeeId: { in: reportIds }, cycleId: { in: cycleIds } },
            select: {
              employeeId: true,
              cycleId: true,
              managerFeedbackScore: true,
              managerFeedback: true,
            },
          })
        : [];
    const byKey = new Map(scores.map((s) => [`${s.employeeId}|${s.cycleId}`, s]));

    return { manager, error: null, reports, openCycles, byKey };
  } catch (err) {
    console.error("[manager/appraisal] failed:", err);
    return { manager: null, error: "Appraisal data is unavailable right now." };
  }
}

export default async function TeamAppraisalPage() {
  const data = await load();

  return (
    <>
      <PageHeader
        title="Team Appraisal"
        description="Enter numeric feedback (0–100) and comments for your direct reports on open cycles. Formula weights are owned by Super Admin."
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
          <span className="text-sm text-text-muted">
            No employee record is linked to your account yet.
          </span>
        </Panel>
      )}

      {data.manager && data.openCycles.length === 0 && (
        <Panel className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <StatusDot state="idle" />
          <p className="text-sm text-text">No open cycles</p>
          <p className="text-xs text-text-muted">
            Feedback can be entered once HR creates an appraisal cycle.
          </p>
        </Panel>
      )}

      {data.manager && data.openCycles.length > 0 && (
        <div className="space-y-4">
          {data.reports.map((r) => {
            // Cycles this report is part of: org-wide or their department.
            const applicable = data.openCycles.filter(
              (c) => c.department === null || c.department === r.department,
            );
            if (applicable.length === 0) return null;
            return (
              <Panel key={r.id}>
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div>
                    <div className="text-sm text-text">{r.name}</div>
                    <div className="font-mono text-xs text-text-muted">
                      {r.employeeCode} · {r.department}
                    </div>
                  </div>
                </div>
                <ul className="divide-y divide-border">
                  {applicable.map((c) => {
                    const existing = data.byKey.get(`${r.id}|${c.id}`);
                    return (
                      <li key={c.id} className="space-y-2 px-4 py-3">
                        <div className="flex items-center gap-2 text-xs text-text-muted">
                          <StatusDot
                            state={existing?.managerFeedbackScore != null ? "good" : "idle"}
                          />
                          <span className="font-mono">{c.period}</span>
                          <span>· {c.department ?? "Org-wide"}</span>
                          {existing?.managerFeedbackScore != null && (
                            <span className="text-good">feedback on file</span>
                          )}
                        </div>
                        <FeedbackForm
                          cycleId={c.id}
                          employeeId={r.id}
                          initialScore={existing?.managerFeedbackScore ?? null}
                          initialComment={existing?.managerFeedback ?? ""}
                        />
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
