import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import {
  ShoutOutForm,
  DeleteShoutOutButton,
} from "@/components/engagement/shoutout-form";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { loadToday } from "@/lib/engagement/today";
import { BirthdaysToday, SpecialDayBanner } from "@/components/engagement/today-widgets";
import { ModulePaused } from "@/components/engagement/module-paused";
import { engagementEnabled } from "@/lib/system-settings";
import { ErrorPanel } from "@/components/ui/notice";

export const dynamic = "force-dynamic";

/** Minutes an author may delete their own post — mirrors the API's window. */
const DELETE_WINDOW_MINUTES = 15;

function relativeTime(d: Date, now: Date): string {
  const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

async function load() {
  const userId = await getEffectiveUserId();
  try {
    const me = userId ? await getEmployeeByClerkId(userId) : null;

    // Three queries: feed (with both employees joined), the roster for the
    // recipient dropdown, and the shared today-data for the celebratory
    // widgets. No per-post lookups.
    const [shoutOuts, people, today] = await Promise.all([
      db.shoutOut.findMany({
        include: {
          fromEmployee: { select: { id: true, name: true, department: true } },
          toEmployee: { select: { id: true, name: true, department: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      db.employee.findMany({
        where: { active: true },
        select: { id: true, name: true, department: true },
        orderBy: [{ department: "asc" }, { name: "asc" }],
      }),
      loadToday(),
    ]);

    return { me, shoutOuts, people, today, error: null };
  } catch (err) {
    console.error("[community] failed:", err);
    return {
      me: null,
      shoutOuts: [],
      people: [],
      today: null,
      error: "The community wall is unavailable right now.",
    };
  }
}

export default async function CommunityPage() {
  // Phase 11: org-wide engagement pause (Module Toggles).
  if (!(await engagementEnabled())) return <ModulePaused title="Community Wall" />;

  const { me, shoutOuts, people, today, error } = await load();
  const now = new Date();
  const cutoff = new Date(now.getTime() - DELETE_WINDOW_MINUTES * 60 * 1000);

  return (
    <>
      <PageHeader
        title="Community"
        description="Shout-outs and celebrations. Visible to everyone, and deliberately kept separate from appraisals — nothing posted here feeds into anyone's review."
      />

      {error && (
        <ErrorPanel>{error}</ErrorPanel>
      )}

      {today && (
        <>
          <SpecialDayBanner holidays={today.holidays} />
          <BirthdaysToday birthdays={today.birthdays} />
        </>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Panel>
            <PanelHeader title="Give a Shout-out" />
            <div className="p-4">
              {me ? (
                <ShoutOutForm people={people.filter((p) => p.id !== me.id)} />
              ) : (
                <p className="text-sm text-text-muted">
                  No employee record is linked to your account yet, so you can&apos;t
                  post. You can still read the wall.
                </p>
              )}
            </div>
          </Panel>
        </div>

        <div className="lg:col-span-2">
          <Panel>
            <PanelHeader title={`The Wall · ${shoutOuts.length}`} />
            {shoutOuts.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-sm text-text">Nothing here yet.</p>
                <p className="mt-1 text-xs text-text-muted">
                  Be the first to recognise a colleague.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {shoutOuts.map((s) => {
                  const mine = me?.id === s.fromEmployeeId;
                  const deletable = mine && s.createdAt >= cutoff;
                  return (
                    <li key={s.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm">
                            <span className="font-medium text-text">
                              {s.fromEmployee.name}
                            </span>
                            <span className="text-text-muted"> → </span>
                            <span className="font-medium text-accent">
                              {s.toEmployee.name}
                            </span>
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-text-muted">
                            {s.message}
                          </p>
                          <p className="mt-1 font-mono text-[10px] text-text-muted">
                            {s.toEmployee.department} · {relativeTime(s.createdAt, now)}
                          </p>
                        </div>
                        {deletable && <DeleteShoutOutButton id={s.id} />}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
