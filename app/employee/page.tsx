import { getEffectiveUserId } from "@/lib/auth";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader, StatCard } from "@/components/ui/panel";
import { StatusDot, StatusLabel, type StatusState } from "@/components/ui/status-dot";
import { ClockInWidget } from "@/components/employee/clock-in-widget";
import { NotificationPanel } from "@/components/employee/notification-panel";
import { TodayWidgets } from "@/components/engagement/today-widgets";
import { loadToday } from "@/lib/engagement/today";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { ownIdleTotals, hm } from "@/lib/idle/aggregate";
import { currentPeriod } from "@/lib/period";
import { scoreOutOfFive } from "@/lib/appraisal/display";

export const dynamic = "force-dynamic";

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
/** Monday 00:00 of the current week. */
function weekStartMonday(now = new Date()): Date {
  const s = startOfDay(now);
  const diffToMon = (s.getDay() + 6) % 7; // 0=Sun..6=Sat -> days since Monday
  s.setDate(s.getDate() - diffToMon);
  return s;
}

async function loadMetrics() {
  const userId = await getEffectiveUserId();
  if (!userId) return null;
  try {
    const employee = await getEmployeeByClerkId(userId);
    if (!employee) return null;
    const { period, monthStart, monthEnd } = currentPeriod();
    const inMonth = { gte: monthStart, lt: monthEnd };
    const now = new Date();
    const todayStart = startOfDay(now);
    const tomorrowStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + 1);
    const weekStart = weekStartMonday(now);
    const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);

    const [prod, target, qual, appraisal, todayAtt, weekAtt, consents, shift, notifications, ownIdle] = await Promise.all([
      db.production.aggregate({
        where: { employeeId: employee.id, date: inMonth },
        _sum: { unitsProduced: true },
      }),
      db.monthlyTarget.findUnique({
        where: { employeeId_period: { employeeId: employee.id, period } },
      }),
      db.qualityReport.aggregate({
        where: { employeeId: employee.id, date: inMonth },
        _avg: { qualityScore: true },
        _count: { _all: true },
      }),
      // Most recent PUBLISHED appraisal score.
      db.appraisalScore.findFirst({
        where: {
          employeeId: employee.id,
          excluded: false,
          finalScore: { not: null },
          cycle: { published: true },
        },
        include: { cycle: { select: { period: true } } },
        orderBy: { cycle: { createdAt: "desc" } },
      }),
      // Today's own attendance row.
      db.attendance.findFirst({
        where: { employeeId: employee.id, date: { gte: todayStart, lt: tomorrowStart } },
      }),
      // This week's own attendance rows.
      db.attendance.findMany({
        where: { employeeId: employee.id, date: { gte: weekStart, lt: weekEnd } },
      }),
      // Own consent records (latest per type derived below).
      db.consentRecord.findMany({
        where: { employeeId: employee.id },
        orderBy: { givenOn: "desc" },
      }),
      // Assigned shift (drives what "late" means for this employee).
      employee.shiftId
        ? db.shift.findUnique({ where: { id: employee.shiftId } })
        : Promise.resolve(null),
      // Phase 7: own notifications — unread first, then most recent.
      db.notification.findMany({
        where: { employeeId: employee.id },
        orderBy: [{ read: "asc" }, { createdAt: "desc" }],
        take: 8,
      }),
      // Their OWN idle/active totals — batched into the same round trip.
      ownIdleTotals(employee.id),
    ]);

    const weekByDate = new Map(weekAtt.map((a) => [ymd(a.date), a]));
    const latestConsent = (type: string) =>
      consents.find((c) => c.consentType === type) ?? null;

    return {
      actual: prod._sum.unitsProduced ?? 0,
      target: target?.targetUnits ?? null,
      qualityAvg: qual._count._all > 0 ? qual._avg.qualityScore ?? null : null,
      qualityCount: qual._count._all,
      appraisalScore: appraisal?.finalScore ?? null,
      appraisalPeriod: appraisal?.cycle.period ?? null,
      today: todayAtt,
      weekStart,
      weekByDate,
      idle: latestConsent("IDLE_TRACKING"),
      shift,
      ownIdle,
      // Serialize Dates — they don't cross the RSC boundary as Date objects.
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        message: n.message,
        read: n.read,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  } catch (err) {
    console.error("[employee/dashboard] metrics failed:", err);
    return null;
  }
}

export default async function EmployeeDashboard() {
  // Both loads run in parallel — the engagement widgets add one batched call,
  // not one query per widget.
  const [m, engagementToday] = await Promise.all([loadMetrics(), loadToday()]);

  // Production vs Target card
  const prodPct =
    m && m.target && m.target > 0 ? Math.round((m.actual / m.target) * 100) : null;
  const prodState: StatusState =
    prodPct === null ? "idle" : prodPct >= 100 ? "good" : prodPct >= 80 ? "warn" : "danger";

  // Quality Score card
  const qState: StatusState =
    m?.qualityAvg == null
      ? "idle"
      : m.qualityAvg >= 90
        ? "good"
        : m.qualityAvg >= 75
          ? "warn"
          : "danger";

  // Appraisal card — most recent published score
  const aScore = m?.appraisalScore ?? null;
  const aState: StatusState =
    aScore == null ? "idle" : aScore >= 80 ? "good" : aScore >= 60 ? "warn" : "danger";

  // Today's Attendance card (real)
  const today = m?.today ?? null;
  const todayState: StatusState = !today ? "idle" : today.lateFlag ? "warn" : "good";
  // Late label handles historical rows with null lateMinutes gracefully.
  const todayLate = today?.lateFlag
    ? today.lateMinutes != null
      ? `${today.lateMinutes} min late`
      : "Late"
    : null;
  const todayStatus = !today
    ? "Not punched in"
    : today.checkOut
      ? `Out ${fmtTime(today.checkOut)}${todayLate ? ` · ${todayLate}` : ""}`
      : todayLate
        ? `Checked in · ${todayLate}`
        : "Checked in · on time";

  // This Week — Attendance panel (real, Mon–Fri)
  const nowDay = startOfDay(new Date());
  const weekRows =
    m?.weekStart == null
      ? []
      : Array.from({ length: 5 }).map((_, i) => {
          const d = new Date(
            m.weekStart.getFullYear(),
            m.weekStart.getMonth(),
            m.weekStart.getDate() + i,
          );
          const rec = m.weekByDate.get(ymd(d));
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

  const idle = m?.idle ?? null;
  const earliestRetention = idle?.retentionExpiry ?? null;

  return (
    <>
      <PageHeader
        title="My Dashboard"
        description="Your attendance, production, quality and appraisal at a glance."
      />

      <TodayWidgets data={engagementToday} />

      {m && m.notifications.length > 0 && (
        <div className="mb-4">
          <NotificationPanel items={m.notifications} />
        </div>
      )}

      <div className="mb-4">
        <ClockInWidget
          initialCheckIn={today?.checkIn ? today.checkIn.toISOString() : null}
          initialCheckOut={today?.checkOut ? today.checkOut.toISOString() : null}
        />
      </div>

      {/* Your shift — so "late" is unambiguous for this employee. */}
      <div className="mb-4 flex items-center gap-2 rounded border border-border bg-surface px-4 py-2.5 text-sm">
        <StatusDot state={m?.shift ? "good" : "warn"} />
        <span className="text-text-muted">Your shift:</span>
        {m?.shift ? (
          <span className="font-mono text-text">
            {m.shift.name} · {m.shift.startTime}–{m.shift.endTime}
            {m.shift.gracePeriodMinutes > 0 ? ` (+${m.shift.gracePeriodMinutes}m grace)` : ""}
          </span>
        ) : (
          <span className="text-text-muted">not assigned — ask HR</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Today's Attendance"
          value={today?.checkIn ? fmtTime(today.checkIn) : "—"}
          state={todayState}
          status={todayStatus}
          hint={today?.channel ?? undefined}
        />
        {/* Real today totals from the same ownIdleTotals batch as the MTD card. */}
        <StatCard
          label="Idle Time (today)"
          value={
            !m?.ownIdle?.consent.active || m.ownIdle.today.totalMinutes === 0
              ? "—"
              : String(m.ownIdle.today.idleMinutes)
          }
          unit={
            m?.ownIdle?.consent.active && m.ownIdle.today.totalMinutes > 0 ? "min" : undefined
          }
          state={
            !m?.ownIdle?.consent.active || m.ownIdle.today.totalMinutes === 0
              ? "idle"
              : m.ownIdle.today.activePct !== null && m.ownIdle.today.activePct < 70
                ? "warn"
                : "good"
          }
          status={
            !m?.ownIdle?.consent.active
              ? "Tracking not active"
              : m.ownIdle.today.totalMinutes === 0
                ? "No data yet"
                : `Active ${hm(m.ownIdle.today.activeMinutes)}`
          }
        />
        <StatCard
          label="Production vs Target"
          value={prodPct === null ? "—" : `${prodPct}%`}
          state={prodState}
          status={
            m && m.target !== null
              ? `${m.actual} / ${m.target} units`
              : "Target not set"
          }
          mono={prodPct !== null}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StatCard
          label="Quality Score"
          value={m?.qualityAvg == null ? "—" : m.qualityAvg.toFixed(1)}
          state={qState}
          status={
            m?.qualityAvg == null
              ? "No reviews yet"
              : `${m.qualityCount} review${m.qualityCount === 1 ? "" : "s"} this month`
          }
          mono={m?.qualityAvg != null}
        />
        {/* Displayed on the 5-point scale; aState above still bands on the
            real 0-100 value. */}
        <StatCard
          label="Appraisal"
          value={scoreOutOfFive(aScore) ?? "—"}
          unit={aScore == null ? undefined : "/ 5"}
          state={aState}
          status={aScore == null ? "Not yet appraised" : (m?.appraisalPeriod ?? "Published")}
          mono={aScore != null}
        />
        {/* Your OWN idle/active data, shown as plainly as HR and your manager
            see it. Nothing about your own tracking is hidden from you. */}
        <StatCard
          label="Active Time · MTD"
          value={
            !m?.ownIdle || m.ownIdle.month.activePct === null
              ? "—"
              : `${m.ownIdle.month.activePct}%`
          }
          state={
            !m?.ownIdle?.consent.active || m.ownIdle.month.activePct === null
              ? "idle"
              : "good"
          }
          status={
            !m?.ownIdle?.consent.active
              ? "Tracking not active"
              : m.ownIdle.month.totalMinutes === 0
                ? "No data yet"
                : `${hm(m.ownIdle.month.activeMinutes)} of ${hm(m.ownIdle.month.totalMinutes)}`
          }
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="This Week — Attendance" />
          <div className="divide-y divide-border">
            {weekRows.length === 0 ? (
              <div className="px-4 py-6 text-sm text-text-muted">No data.</div>
            ) : (
              weekRows.map((r) => (
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

        <Panel>
          <PanelHeader title="Consent & Compliance" />
          <div className="space-y-3 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Idle-time tracking</span>
              <StatusLabel state={idle ? "good" : "idle"}>
                {idle ? "Consent on file" : "Not on file"}
              </StatusLabel>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Data retention</span>
              <span className="font-mono text-xs text-text-muted">
                {earliestRetention
                  ? `expires ${ymd(earliestRetention)}`
                  : "no expiry set"}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2 rounded border border-border bg-surface-raised px-3 py-2">
              <StatusDot state="idle" />
              <span className="text-xs text-text-muted">
                Consent is recorded by HR on the Compliance &amp; Consent page.
              </span>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
