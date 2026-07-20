import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { PulseRespondForm } from "@/components/engagement/pulse-respond-form";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { answeredSurveyIds } from "@/lib/engagement/pulse";

export const dynamic = "force-dynamic";

async function load() {
  const userId = await getEffectiveUserId();
  try {
    const me = userId ? await getEmployeeByClerkId(userId) : null;
    const now = new Date();

    const surveys = await db.pulseSurvey.findMany({
      where: {
        active: true,
        OR: [{ closesAt: null }, { closesAt: { gt: now } }],
      },
      select: {
        id: true,
        question: true,
        scaleMin: true,
        scaleMax: true,
        closesAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // Which ones this person has already answered. Reads the turnstile only —
    // it holds no ratings, so this cannot reveal anyone's answer, including
    // the viewer's own.
    const answered = me ? await answeredSurveyIds(me.id) : new Set<string>();

    return { me, surveys, answered, error: null };
  } catch (err) {
    console.error("[pulse] failed:", err);
    return {
      me: null,
      surveys: [],
      answered: new Set<string>(),
      error: "Surveys are unavailable right now.",
    };
  }
}

export default async function PulsePage() {
  const { me, surveys, answered, error } = await load();
  const open = surveys.filter((s) => !answered.has(s.id));

  return (
    <>
      <PageHeader
        title="Pulse Surveys"
        description="Quick, anonymous check-ins. Your answers are never linked to you."
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
            <p className="text-text">How anonymity works here</p>
            <p className="mt-1">
              Your rating is stored in a table that has no employee field at
              all. A separate record notes only <em>that</em> you responded, so
              you aren&apos;t asked twice — it never stores what you said. The
              two are never joined, anywhere. HR sees averages and counts only,
              never individual answers.
            </p>
          </div>
        </div>
      </Panel>

      {!me && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="warn" />
          <span className="text-sm text-text-muted">
            No employee record is linked to your account yet, so you can&apos;t
            respond.
          </span>
        </Panel>
      )}

      {surveys.length === 0 ? (
        <Panel className="px-4 py-12 text-center">
          <p className="text-sm text-text">No open surveys right now.</p>
          <p className="mt-1 text-xs text-text-muted">
            We&apos;ll let you know when there&apos;s something to weigh in on.
          </p>
        </Panel>
      ) : (
        <div className="space-y-4">
          {surveys.map((s) => {
            const done = answered.has(s.id);
            return (
              <Panel key={s.id}>
                <PanelHeader
                  title={done ? "Answered" : "Open"}
                  action={
                    s.closesAt ? (
                      <span className="font-mono text-[11px] text-text-muted">
                        closes {s.closesAt.toISOString().slice(0, 10)}
                      </span>
                    ) : undefined
                  }
                />
                <div className="p-4">
                  <p className="mb-3 text-sm text-text">{s.question}</p>
                  {done ? (
                    <p className="flex items-center gap-2 text-sm text-text-muted">
                      <StatusDot state="good" />
                      You&apos;ve responded to this one. Thank you.
                    </p>
                  ) : me ? (
                    <PulseRespondForm
                      surveyId={s.id}
                      scaleMin={s.scaleMin}
                      scaleMax={s.scaleMax}
                    />
                  ) : null}
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {surveys.length > 0 && open.length === 0 && (
        <p className="mt-4 text-center text-xs text-text-muted">
          You&apos;re all caught up.
        </p>
      )}
    </>
  );
}
