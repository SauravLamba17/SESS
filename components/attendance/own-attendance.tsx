import { Panel, PanelHeader, StatCard } from "@/components/ui/panel";
import { StatusDot, StatusLabel, type StatusState } from "@/components/ui/status-dot";
import { fmtTime, startOfDay, ymd, type OwnAttendance } from "@/lib/attendance/own-summary";

/**
 * The three presentational pieces that sit around the clock-in widget: the
 * shift banner, the "Today's Attendance" card, and the "This Week" panel.
 *
 * Lifted verbatim out of app/employee/page.tsx when the Manager dashboard
 * gained web punching, so both portals render identical status wording,
 * thresholds and colours from one definition. Server components — no client
 * state; the interactive part is ClockInWidget, which is already shared.
 */

/** Your assigned shift, so "late" is unambiguous for this person. */
export function ShiftBanner({ shift }: { shift: OwnAttendance["shift"] }) {
  return (
    <div className="mb-4 flex items-center gap-2 rounded border border-border bg-surface px-4 py-2.5 text-sm">
      <StatusDot state={shift ? "good" : "warn"} />
      <span className="text-text-muted">Your shift:</span>
      {shift ? (
        <span className="font-mono text-text">
          {shift.name} · {shift.startTime}–{shift.endTime}
          {shift.gracePeriodMinutes > 0 ? ` (+${shift.gracePeriodMinutes}m grace)` : ""}
        </span>
      ) : (
        <span className="text-text-muted">not assigned — ask HR</span>
      )}
    </div>
  );
}

export function TodayAttendanceCard({ today }: { today: OwnAttendance["today"] }) {
  const state: StatusState = !today ? "idle" : today.lateFlag ? "warn" : "good";
  // Late label handles historical rows with null lateMinutes gracefully.
  const late = today?.lateFlag
    ? today.lateMinutes != null
      ? `${today.lateMinutes} min late`
      : "Late"
    : null;
  const status = !today
    ? "Not punched in"
    : today.checkOut
      ? `Out ${fmtTime(today.checkOut)}${late ? ` · ${late}` : ""}`
      : late
        ? `Checked in · ${late}`
        : "Checked in · on time";

  return (
    <StatCard
      label="Today's Attendance"
      value={today?.checkIn ? fmtTime(today.checkIn) : "—"}
      state={state}
      status={status}
      hint={today?.channel ?? undefined}
    />
  );
}

/** Mon–Fri strip of this week's own punches. */
export function WeekAttendancePanel({
  weekStart,
  weekByDate,
}: {
  weekStart: OwnAttendance["weekStart"] | null;
  weekByDate: OwnAttendance["weekByDate"];
}) {
  const nowDay = startOfDay(new Date());
  const rows =
    weekStart == null
      ? []
      : Array.from({ length: 5 }).map((_, i) => {
          const d = new Date(
            weekStart.getFullYear(),
            weekStart.getMonth(),
            weekStart.getDate() + i,
          );
          const rec = weekByDate.get(ymd(d));
          const label = d.toLocaleDateString([], { weekday: "short", day: "2-digit" });
          const isToday = d.getTime() === nowDay.getTime();
          const isFuture = d.getTime() > nowDay.getTime();
          let s: StatusState = "idle";
          let l = "—";
          let t = "—";
          if (rec?.checkIn) {
            t = `${fmtTime(rec.checkIn)} – ${rec.checkOut ? fmtTime(rec.checkOut) : "—"}`;
            if (!rec.checkOut && isToday) { s = "idle"; l = "In progress"; }
            else if (rec.lateFlag) { s = "warn"; l = rec.lateMinutes != null ? `${rec.lateMinutes}m late` : "Late"; }
            else { s = "good"; l = "On time"; }
          } else if (isFuture) { s = "idle"; l = "—"; }
          else if (isToday) { s = "idle"; l = "Not punched"; }
          else { s = "danger"; l = "Absent"; }
          return { key: ymd(d), label, t, s, l };
        });

  return (
    <Panel>
      <PanelHeader title="This Week — Attendance" />
      <div className="divide-y divide-border">
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-text-muted">No data.</div>
        ) : (
          rows.map((r) => (
            <div
              key={r.key}
              className="flex items-center justify-between px-4 py-2.5 text-sm"
            >
              <span className="font-mono text-text-muted">{r.label}</span>
              <span className="font-mono text-text">{r.t}</span>
              <StatusLabel state={r.s} className="text-text-muted">
                {r.l}
              </StatusLabel>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
