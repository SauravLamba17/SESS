import { getEffectiveUserId } from "@/lib/auth";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel } from "@/components/ui/panel";
import { StatusDot, type StatusState } from "@/components/ui/status-dot";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import {
  formatScoreOutOfFive,
  formatComponentOutOf5,
} from "@/lib/appraisal/display";

export const dynamic = "force-dynamic";

// Shape of AppraisalScore.componentScoresJson written by the compute route.
interface Datum {
  hasData: boolean;
  value: number | null;
  weight: number;
}
interface PunctBreakdown {
  frequencyScore: number;
  severityScore: number;
  lateCount: number;
  totalPunchDays: number;
  avgLateMinutesAmongLateDays: number;
}
interface PunctDatum extends Datum {
  breakdown?: PunctBreakdown | null;
}
interface ComponentScores {
  punctuality?: PunctDatum;
  production?: Datum;
  quality?: Datum;
  feedback?: Datum;
  warningPenalty?: { releasedWarnings: number; pointsEach: number; total: number };
  weightedAverage?: number | null;
}

const COMPONENT_LABELS: { key: keyof ComponentScores; label: string }[] = [
  { key: "punctuality", label: "Punctuality" },
  { key: "production", label: "Production" },
  { key: "quality", label: "Quality" },
  { key: "feedback", label: "Manager Feedback" },
];

/**
 * Banding still compares the REAL 0-100 score. Only the rendering below is
 * transformed to /5 — the thresholds must not drift onto a display scale.
 */
function scoreState(score: number): StatusState {
  if (score >= 80) return "good";
  if (score >= 60) return "warn";
  return "danger";
}

async function load() {
  const userId = await getEffectiveUserId();
  if (!userId) return { employee: null, error: null };
  try {
    const employee = await getEmployeeByClerkId(userId);
    if (!employee) return { employee: null, error: null };
    // Published cycles only; never expose in-progress/unpublished scores.
    const scores = await db.appraisalScore.findMany({
      where: {
        employeeId: employee.id,
        excluded: false,
        finalScore: { not: null },
        cycle: { published: true },
      },
      include: { cycle: { select: { period: true, department: true } } },
      orderBy: { cycle: { createdAt: "desc" } },
    });
    return { employee, error: null, scores };
  } catch (err) {
    console.error("[employee/appraisal] failed:", err);
    return { employee: null, error: "Appraisal data is unavailable right now." };
  }
}

export default async function MyAppraisalPage() {
  const data = await load();

  return (
    <>
      <PageHeader
        title="My Appraisal"
        description="Your published appraisal scores and how each component contributed."
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
          <span className="text-sm text-text-muted">
            No employee record is linked to your account yet.
          </span>
        </Panel>
      )}

      {data.employee && data.scores && data.scores.length === 0 && (
        <Panel className="flex flex-col items-center gap-2 px-4 py-12 text-center">
          <StatusDot state="idle" />
          <p className="text-sm text-text">No published appraisals yet</p>
          <p className="text-xs text-text-muted">
            Your scores appear here once HR publishes a cycle you were part of.
          </p>
        </Panel>
      )}

      {data.employee && data.scores && data.scores.length > 0 && (
        <div className="space-y-4">
          {data.scores.map((s) => {
            const cs = (s.componentScoresJson ?? {}) as ComponentScores;
            const final = s.finalScore ?? 0;
            return (
              <Panel key={s.id}>
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-text">{s.cycle.period}</span>
                    <span className="text-text-muted">
                      · {s.cycle.department ?? "Org-wide"}
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-2">
                    <StatusDot state={scoreState(final)} />
                    <span className="font-mono text-lg text-text">
                      {formatScoreOutOfFive(final)}
                    </span>
                  </span>
                </div>
                <div className="space-y-2 p-4 text-sm">
                  {COMPONENT_LABELS.map(({ key, label }) => {
                    const d = cs[key] as Datum | undefined;
                    const bd = key === "punctuality" ? cs.punctuality?.breakdown : null;
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">
                            {label}{" "}
                            <span className="font-mono text-xs">
                              (w{d?.weight ?? 0})
                            </span>
                          </span>
                          {d?.hasData ? (
                            <span className="font-mono text-text">
                              {formatComponentOutOf5(d.value)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                              <StatusDot state="idle" /> no data
                            </span>
                          )}
                        </div>
                        {/* Frequency + severity breakdown — tells a pattern from a single incident. */}
                        {bd && (
                          <div className="mt-0.5 pl-1 text-[11px] text-text-muted">
                            Frequency: {formatComponentOutOf5(bd.frequencyScore)} — late{" "}
                            {bd.lateCount} of {bd.totalPunchDays} days · Severity:{" "}
                            {formatComponentOutOf5(bd.severityScore)}
                            {bd.lateCount > 0
                              ? ` — averaged ${bd.avgLateMinutesAmongLateDays.toFixed(0)} min late on late days`
                              : " — never late"}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between border-t border-border pt-2">
                    <span className="text-text-muted">
                      Warning penalty{" "}
                      <span className="font-mono text-xs">
                        ({cs.warningPenalty?.releasedWarnings ?? 0} ×{" "}
                        {cs.warningPenalty?.pointsEach ?? 0})
                      </span>
                    </span>
                    <span className="font-mono text-danger">
                      −{cs.warningPenalty?.total ?? 0}
                    </span>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
