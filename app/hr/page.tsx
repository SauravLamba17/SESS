import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader, StatCard } from "@/components/ui/panel";
import { StatusLabel } from "@/components/ui/status-dot";
import { NotificationPanel } from "@/components/employee/notification-panel";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { TodayWidgets } from "@/components/engagement/today-widgets";
import { loadToday } from "@/lib/engagement/today";
import { currentPeriod } from "@/lib/period";

export const dynamic = "force-dynamic";

/** Retention rows this close to their scheduled redaction date need attention. */
const RETENTION_WARNING_DAYS = 30;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * HR's own notifications — the same Notification model, the same panel
 * component as the Employee dashboard. HR staff are Employees too, so their
 * notifications are addressed exactly like anyone else's.
 */
async function loadNotifications() {
  const userId = await getEffectiveUserId();
  if (!userId) return [];
  try {
    const me = await getEmployeeByClerkId(userId);
    if (!me) return [];
    const rows = await db.notification.findMany({
      where: { employeeId: me.id },
      orderBy: [{ read: "asc" }, { createdAt: "desc" }],
      take: 10,
    });
    return rows.map((n) => ({
      id: n.id,
      type: n.type,
      message: n.message,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
    }));
  } catch (err) {
    console.error("[hr/dashboard] notifications failed:", err);
    return [];
  }
}

/**
 * Every figure on this dashboard, in ONE Promise.all — the same shape the
 * Employee, Manager and Super Admin dashboards already use.
 *
 * Until now this page was the last one still rendering hardcoded literals
 * ("248 employees", "93% present"), which meant it stated numbers that were
 * never true of the actual database. Nothing here scales with headcount: every
 * entry is a count or groupBy the database resolves, plus one bounded
 * distinct-department query.
 */
async function load() {
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const { period } = currentPeriod(now);
  const retentionCutoff = new Date(
    now.getTime() + RETENTION_WARNING_DAYS * 24 * 60 * 60 * 1000,
  );

  try {
    const [
      activeCount,
      departments,
      presentToday,
      payrollByStatus,
      openWarnings,
      unreleasedWarnings,
      idleConsent,
      retentionExpiring,
    ] = await Promise.all([
      db.employee.count({ where: { active: true } }),
      db.employee.findMany({
        where: { active: true },
        select: { department: true },
        distinct: ["department"],
      }),
      // Distinct employees with a punch today — a second punch must not count
      // twice, so this is a distinct-employee count, not an attendance count.
      db.attendance.findMany({
        where: { date: { gte: today, lt: tomorrow } },
        select: { employeeId: true },
        distinct: ["employeeId"],
      }),
      db.payroll.groupBy({
        by: ["status"],
        where: { month: period },
        _count: { _all: true },
      }),
      db.warningLetter.count({ where: { acknowledged: false } }),
      db.warningLetter.count({ where: { status: "DRAFT" } }),
      // IDLE_TRACKING is the ONLY consent type that exists — Phase 11 removed
      // FACE_VERIFICATION along with the feature. Distinct by employee so a
      // re-consent does not inflate the count.
      db.consentRecord.findMany({
        where: { consentType: "IDLE_TRACKING" },
        select: { employeeId: true },
        distinct: ["employeeId"],
      }),
      db.employee.count({
        where: {
          active: false,
          redactedAt: null,
          scheduledRedactionAt: { not: null, lte: retentionCutoff },
        },
      }),
    ]);

    const countFor = (s: "DRAFT" | "SUBMITTED" | "FINALIZED") =>
      payrollByStatus.find((r) => r.status === s)?._count._all ?? 0;

    return {
      error: null as string | null,
      activeCount,
      departmentCount: departments.length,
      presentCount: presentToday.length,
      period,
      payroll: {
        draft: countFor("DRAFT"),
        submitted: countFor("SUBMITTED"),
        finalized: countFor("FINALIZED"),
      },
      openWarnings,
      unreleasedWarnings,
      idleConsentCount: idleConsent.length,
      retentionExpiring,
    };
  } catch (err) {
    console.error("[hr/dashboard] load failed:", err);
    return {
      error: "Dashboard figures could not be loaded.",
      activeCount: 0,
      departmentCount: 0,
      presentCount: 0,
      period,
      payroll: { draft: 0, submitted: 0, finalized: 0 },
      openWarnings: 0,
      unreleasedWarnings: 0,
      idleConsentCount: 0,
      retentionExpiring: 0,
    };
  }
}

/** Whole-percent share, guarding the zero-headcount case. */
function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

export default async function HRDashboard() {
  const [notifications, today, d] = await Promise.all([
    loadNotifications(),
    loadToday(),
    load(),
  ]);

  const presentPct = pct(d.presentCount, d.activeCount);
  // The payroll card reports the FURTHEST stage this month has reached.
  const payrollStage = d.payroll.finalized
    ? { value: "Finalized", state: "good" as const, status: `${d.payroll.finalized} locked` }
    : d.payroll.submitted
      ? {
          value: "Submitted",
          state: "warn" as const,
          status: "Awaiting Super Admin",
        }
      : d.payroll.draft
        ? { value: "Draft", state: "warn" as const, status: "Awaiting submission" }
        : { value: "Not started", state: "idle" as const, status: "No rows yet" };

  return (
    <>
      <PageHeader
        title="HR Dashboard"
        description="Organisation-wide attendance, payroll, appraisal and compliance."
      />

      <TodayWidgets data={today} />

      {d.error && (
        <Panel className="mb-4 border-danger/40 p-4">
          <p className="text-sm text-danger">{d.error}</p>
        </Panel>
      )}

      {notifications.length > 0 && (
        <div className="mb-4">
          <NotificationPanel items={notifications} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active Employees"
          value={d.activeCount}
          state={d.activeCount > 0 ? "good" : "idle"}
          status={`${d.departmentCount} department${d.departmentCount === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Present Today"
          value={`${presentPct}%`}
          state={presentPct >= 85 ? "good" : presentPct > 0 ? "warn" : "idle"}
          status={`${d.presentCount} / ${d.activeCount}`}
        />
        <StatCard
          label={`Payroll · ${d.period}`}
          value={payrollStage.value}
          state={payrollStage.state}
          status={payrollStage.status}
          mono={false}
        />
        <StatCard
          label="Open Warning Letters"
          value={d.openWarnings}
          state={d.openWarnings > 0 ? "warn" : "good"}
          status={`${d.unreleasedWarnings} pending release`}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Payroll Pipeline" />
          <div className="space-y-3 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-muted">DRAFT (HR editing)</span>
              <StatusLabel state={d.payroll.draft > 0 ? "warn" : "idle"}>
                {d.payroll.draft} employees
              </StatusLabel>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">SUBMITTED (to Super Admin)</span>
              <StatusLabel state="idle">{d.payroll.submitted} employees</StatusLabel>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">FINALIZED (locked)</span>
              <StatusLabel state={d.payroll.finalized > 0 ? "good" : "idle"}>
                {d.payroll.finalized} employees
              </StatusLabel>
            </div>
            <p className="pt-2 text-xs text-text-muted">
              HR edits and submits. Only Super Admin finalizes/locks — payroll is
              immutable once finalized.
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Compliance & Consent" />
          <div className="space-y-3 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Idle-tracking consent</span>
              <StatusLabel
                state={d.idleConsentCount >= d.activeCount ? "good" : "warn"}
              >
                {d.idleConsentCount} / {d.activeCount}
              </StatusLabel>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">
                Retention expiring &lt; {RETENTION_WARNING_DAYS}d
              </span>
              <StatusLabel state={d.retentionExpiring > 0 ? "danger" : "good"}>
                {d.retentionExpiring} record{d.retentionExpiring === 1 ? "" : "s"}
              </StatusLabel>
            </div>
            <p className="pt-2 text-xs text-text-muted">
              Idle tracking is consent-gated: no active consent, no tracking.
              Retention rows are redacted, never deleted — the financial record
              stays intact.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
