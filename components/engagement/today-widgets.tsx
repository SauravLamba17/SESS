import { Cake, PartyPopper } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot, type StatusState } from "@/components/ui/status-dot";
import type { TodayData, PresenceStatus } from "@/lib/engagement/today";

/**
 * The three engagement widgets, rendered together from one batched load.
 *
 * Server components — no client JS, since none of this is interactive.
 */

const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  IN: "In",
  ON_LEAVE: "On Leave",
  NOT_MARKED: "Not yet marked",
};

// "Not yet marked" is deliberately IDLE, not a warning. It means the system
// hasn't seen a punch yet — not that anyone did anything wrong.
const PRESENCE_DOT: Record<PresenceStatus, StatusState> = {
  IN: "good",
  ON_LEAVE: "idle",
  NOT_MARKED: "idle",
};

/** Celebratory banner for a holiday falling today. */
export function SpecialDayBanner({ holidays }: { holidays: TodayData["holidays"] }) {
  if (holidays.length === 0) return null;
  return (
    <Panel className="mb-4 border-accent/40 bg-accent/10 px-4 py-3">
      <div className="flex items-center gap-3">
        <PartyPopper size={18} className="shrink-0 text-accent" />
        <div>
          <p className="text-sm font-medium text-accent">
            Today is {holidays.map((h) => h.name).join(" & ")}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            Wishing everyone a happy {holidays[0].name} from all of us.
          </p>
        </div>
      </div>
    </Panel>
  );
}

/** Names only. Never the date of birth, never an age. */
export function BirthdaysToday({ birthdays }: { birthdays: TodayData["birthdays"] }) {
  if (birthdays.length === 0) return null;
  return (
    <Panel className="mb-4 px-4 py-3">
      <div className="flex items-start gap-3">
        <Cake size={17} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0">
          <p className="text-sm text-text">
            {birthdays.length === 1
              ? "It's a birthday today"
              : `${birthdays.length} birthdays today`}
          </p>
          <p className="mt-1 text-sm text-text-muted">
            {birthdays.map((b, i) => (
              <span key={b.id}>
                {i > 0 && ", "}
                <span className="text-text">{b.name}</span>
                <span className="text-text-muted"> ({b.department})</span>
              </span>
            ))}
          </p>
          <p className="mt-1.5 text-[11px] text-text-muted">
            Say happy birthday on the{" "}
            <a href="/community" className="text-accent underline">
              community wall
            </a>
            .
          </p>
        </div>
      </div>
    </Panel>
  );
}

/**
 * Who's in today. PRESENCE ONLY.
 *
 * Shows a name and one of three states. There is no check-in time, no late
 * flag, no minutes-late, and no link to any performance screen — the
 * underlying query does not even select those columns.
 */
export function WhosInToday({
  presence,
  counts,
}: {
  presence: TodayData["presence"];
  counts: TodayData["counts"];
}) {
  const byDept = new Map<string, typeof presence>();
  for (const p of presence) {
    const arr = byDept.get(p.department) ?? [];
    arr.push(p);
    byDept.set(p.department, arr);
  }

  return (
    <Panel>
      <PanelHeader
        title="Who's In Today"
        action={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <StatusDot state="good" />
              <span className="font-mono text-text">{counts.in}</span>
              <span className="text-text-muted">in</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <StatusDot state="idle" />
              <span className="font-mono text-text">{counts.onLeave}</span>
              <span className="text-text-muted">on leave</span>
            </span>
            <span className="text-text-muted">
              <span className="font-mono">{counts.notMarked}</span> not marked
            </span>
          </span>
        }
      />
      {presence.length === 0 ? (
        <div className="px-4 py-8 text-sm text-text-muted">No active employees.</div>
      ) : (
        <div className="divide-y divide-border">
          {Array.from(byDept.entries()).map(([dept, people]) => (
            <div key={dept} className="px-4 py-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                {dept}
              </p>
              <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                {people.map((p) => (
                  <li key={p.id} className="inline-flex items-center gap-2 text-sm">
                    <StatusDot state={PRESENCE_DOT[p.status]} />
                    <span className="text-text">{p.name}</span>
                    <span className="text-xs text-text-muted">
                      {PRESENCE_LABEL[p.status]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <p className="border-t border-border px-4 py-2.5 text-[11px] text-text-muted">
        Presence only — this view shows whether someone has marked attendance
        today, not when they arrived.
      </p>
    </Panel>
  );
}

/** All three, in the order they should appear on a dashboard. */
export function TodayWidgets({ data }: { data: TodayData }) {
  return (
    <>
      <SpecialDayBanner holidays={data.holidays} />
      <BirthdaysToday birthdays={data.birthdays} />
      <WhosInToday presence={data.presence} counts={data.counts} />
    </>
  );
}
