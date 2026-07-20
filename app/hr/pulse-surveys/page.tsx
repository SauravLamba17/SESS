import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import {
  PulseSurveyForm,
  SurveyToggleButton,
} from "@/components/hr/pulse-survey-manager";
import { db } from "@/lib/db";
import { aggregateSurveys, type PulseAggregate } from "@/lib/engagement/pulse";

export const dynamic = "force-dynamic";

async function load() {
  try {
    const surveys = await db.pulseSurvey.findMany({
      select: {
        id: true,
        question: true,
        scaleMin: true,
        scaleMax: true,
        active: true,
        closesAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // ONE groupBy across every survey — aggregates only, never rows. This is
    // the sole read path to PulseSurveyResponse in the entire codebase.
    const aggregates = await aggregateSurveys(surveys);

    return { surveys, aggregates, error: null };
  } catch (err) {
    console.error("[hr/pulse-surveys] failed:", err);
    return {
      surveys: [],
      aggregates: new Map<string, PulseAggregate>(),
      error: "Surveys are unavailable right now.",
    };
  }
}

export default async function PulseSurveysPage() {
  const { surveys, aggregates, error } = await load();

  return (
    <>
      <PageHeader
        title="Pulse Surveys"
        description="Short anonymous check-ins. You see averages and distributions only — individual responses are not stored against anyone, so there is nothing to drill into."
      />

      {error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{error}</span>
        </Panel>
      )}

      <Panel className="mb-5 px-4 py-3">
        <div className="flex items-start gap-3">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-good" />
          <div className="text-xs text-text-muted">
            <p className="text-text">Why you can&apos;t see who said what</p>
            <p className="mt-1">
              Ratings are stored with no employee field. A separate record
              tracks only that someone responded, to stop double-voting — it
              holds no rating. The two are never joined, so individual answers
              are not hidden from you, they genuinely do not exist in a
              linkable form. Small response counts still reveal a lot, so treat
              anything under about five responses as directional only.
            </p>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Panel>
            <PanelHeader title="New Survey" />
            <div className="p-4">
              <PulseSurveyForm />
            </div>
          </Panel>
        </div>

        <div className="space-y-4 lg:col-span-2">
          {surveys.length === 0 ? (
            <Panel className="px-4 py-12 text-center text-sm text-text-muted">
              No surveys yet — create your first one.
            </Panel>
          ) : (
            surveys.map((s) => {
              const agg = aggregates.get(s.id);
              const total = agg?.responseCount ?? 0;
              const maxCount = Math.max(1, ...(agg?.distribution.map((d) => d.count) ?? [1]));
              return (
                <Panel key={s.id}>
                  <PanelHeader
                    title={s.active ? "Open" : "Closed"}
                    action={
                      <span className="inline-flex items-center gap-3">
                        <span className="font-mono text-[11px] text-text-muted">
                          {total} response{total === 1 ? "" : "s"}
                          {agg?.average !== null && agg?.average !== undefined
                            ? ` · avg ${agg.average}`
                            : ""}
                        </span>
                        <SurveyToggleButton id={s.id} active={s.active} />
                      </span>
                    }
                  />
                  <div className="p-4">
                    <p className="mb-3 text-sm text-text">{s.question}</p>

                    {total === 0 ? (
                      <p className="text-xs text-text-muted">
                        No responses yet.
                      </p>
                    ) : (
                      <>
                        <div className="space-y-1.5">
                          {agg!.distribution.map((d) => (
                            <div key={d.rating} className="flex items-center gap-2">
                              <span className="w-4 shrink-0 text-right font-mono text-[11px] text-text-muted">
                                {d.rating}
                              </span>
                              <div className="h-4 flex-1 overflow-hidden rounded-sm bg-surface-raised">
                                <div
                                  className="h-full bg-accent/60"
                                  style={{ width: `${(d.count / maxCount) * 100}%` }}
                                />
                              </div>
                              <span className="w-8 shrink-0 font-mono text-[11px] text-text-muted">
                                {d.count}
                              </span>
                            </div>
                          ))}
                        </div>
                        {total < 5 && (
                          <p className="mt-2 text-[10px] text-warn">
                            Only {total} response{total === 1 ? "" : "s"} — too
                            few to read much into.
                          </p>
                        )}
                      </>
                    )}

                    <p className="mt-3 font-mono text-[10px] text-text-muted">
                      scale {s.scaleMin}–{s.scaleMax} · created{" "}
                      {s.createdAt.toISOString().slice(0, 10)}
                      {s.closesAt && ` · closes ${s.closesAt.toISOString().slice(0, 10)}`}
                    </p>
                  </div>
                </Panel>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
