import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { HolidayForm, RemoveHolidayButton } from "@/components/hr/holiday-manager";
import { db } from "@/lib/db";
import { ErrorPanel } from "@/components/ui/notice";

export const dynamic = "force-dynamic";

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

async function load() {
  try {
    const holidays = await db.holiday.findMany({ orderBy: { date: "asc" } });
    return { holidays, error: null };
  } catch (err) {
    console.error("[hr/holidays] failed:", err);
    return { holidays: [], error: "The holiday calendar is unavailable right now." };
  }
}

export default async function HolidaysPage() {
  const { holidays, error } = await load();
  const today = startOfDay(new Date());

  const upcoming = holidays.filter((h) => startOfDay(h.date) >= today);
  const past = holidays.filter((h) => startOfDay(h.date) < today).reverse();

  function row(h: (typeof holidays)[number], isToday: boolean) {
    return (
      <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
        <span className="inline-flex items-center gap-2.5 text-sm">
          <StatusDot state={isToday ? "good" : "idle"} />
          <span className="text-text">{h.name}</span>
          {isToday && (
            <span className="rounded border border-good/40 px-1.5 py-0.5 text-[10px] uppercase text-good">
              today
            </span>
          )}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="font-mono text-xs text-text-muted">
            {h.date.toLocaleDateString([], {
              weekday: "short",
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </span>
          <RemoveHolidayButton id={h.id} name={h.name} />
        </span>
      </li>
    );
  }

  return (
    <>
      <PageHeader
        title="Holiday Calendar"
        description="Holidays drive the celebratory banner across every portal. One row per actual date — no recurrence rules, because festival dates move each year."
      />

      {error && (
        <ErrorPanel>{error}</ErrorPanel>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Panel>
            <PanelHeader title="Add Holiday" />
            <div className="p-4">
              <HolidayForm />
            </div>
          </Panel>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Panel>
            <PanelHeader title={`Upcoming · ${upcoming.length}`} />
            {upcoming.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-text-muted">
                No upcoming holidays on the calendar.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {upcoming.map((h) =>
                  row(h, startOfDay(h.date).getTime() === today.getTime()),
                )}
              </ul>
            )}
          </Panel>

          {past.length > 0 && (
            <Panel>
              <PanelHeader title={`Past · ${past.length}`} />
              <ul className="divide-y divide-border opacity-70">
                {past.slice(0, 20).map((h) => row(h, false))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
