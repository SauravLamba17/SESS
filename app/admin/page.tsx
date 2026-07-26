import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader, StatCard } from "@/components/ui/panel";
import { StatusDot, StatusLabel } from "@/components/ui/status-dot";
import { ImpersonatePanel } from "@/components/admin/impersonate-panel";
import { TodayWidgets } from "@/components/engagement/today-widgets";
import {
  HeadcountTrendChart,
  DepartmentHeadcountChart,
  RecruitmentFunnelChart,
  RoleDistributionChart,
} from "@/components/admin/dashboard-charts";
import { loadToday } from "@/lib/engagement/today";
import { db } from "@/lib/db";
import { moduleToggleValues } from "@/lib/system-settings";
import { scoreOutOfFive } from "@/lib/appraisal/display";
import type { Role } from "@/lib/auth-types";
// Phase 12's pure aggregations, reused rather than reimplemented.
import { computeHeadcount, headcountOn } from "@/lib/reports/headcount";
import { computeRecruitmentFunnel } from "@/lib/reports/recruitment-funnel";
import { parseRange, ymd, monthKey } from "@/lib/reports/range";

export const dynamic = "force-dynamic";

/** Hours after check-in past which an open row means "forgot to clock out". */
const FORGOTTEN_CHECKOUT_HOURS = 14;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Everything the dashboard needs, in ONE Promise.all.
 *
 * Nothing here scales with headcount: each entry is a count/groupBy the
 * database resolves, or a bounded findMany (today's attendance, today's leave,
 * six months of employee rows for the trend). The heavy lifting — headcount
 * banding and funnel conversion — runs through Phase 12's existing pure
 * functions on already-fetched rows, so this page introduces no new
 * aggregation logic and no N+1.
 */
async function load() {
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const forgottenBefore = new Date(now.getTime() - FORGOTTEN_CHECKOUT_HOURS * 3_600_000);
  // Six months back, inclusive of the current one.
  const trendStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const range = parseRange(ymd(trendStart), ymd(now));
  if (!range.ok) throw new Error("dashboard range failed to parse");

  try {
    const [
      employees,
      roleGroups,
      openReqs,
      submittedPayroll,
      draftOffers,
      appraisalAgg,
      audit24h,
      lateToday,
      onLeaveToday,
      openRows,
      applications,
      syncFailures,
      toggles,
      dbAlive,
    ] = await Promise.all([
      // One employee fetch feeds headcount, departments AND the 6-month trend.
      db.employee.findMany({
        select: {
          id: true,
          name: true,
          employeeCode: true,
          department: true,
          active: true,
          joiningDate: true,
          offboardedAt: true,
        },
      }),
      db.user.groupBy({ by: ["role"], _count: { _all: true } }),
      db.jobRequisition.count({ where: { status: "OPEN" } }),
      db.payroll.groupBy({
        by: ["month"],
        where: { status: "SUBMITTED" },
        _count: { _all: true },
      }),
      db.offer.count({ where: { status: "DRAFT" } }),
      db.appraisalScore.aggregate({
        where: { excluded: false, finalScore: { not: null }, cycle: { published: true } },
        _avg: { finalScore: true },
        _count: { _all: true },
      }),
      db.auditLog.count({ where: { timestamp: { gte: dayAgo } } }),
      // Real attendance for TODAY — late arrivals, with shift and department.
      db.attendance.findMany({
        where: { date: { gte: today, lt: tomorrow }, lateFlag: true },
        select: {
          id: true,
          checkIn: true,
          lateMinutes: true,
          employee: {
            select: {
              name: true,
              employeeCode: true,
              department: true,
              shift: { select: { name: true, startTime: true, endTime: true } },
            },
          },
        },
        orderBy: { lateMinutes: "desc" },
        take: 10,
      }),
      // Real approved leave spanning today.
      db.leaveRequest.findMany({
        where: {
          status: "APPROVED",
          startDate: { lte: tomorrow },
          endDate: { gte: today },
        },
        select: {
          id: true,
          startDate: true,
          endDate: true,
          employee: {
            select: { name: true, employeeCode: true, department: true },
          },
        },
        orderBy: { startDate: "asc" },
        take: 10,
      }),
      db.attendance.count({
        where: { checkOut: null, checkIn: { not: null, lt: forgottenBefore } },
      }),
      db.application.findMany({
        where: { createdAt: { gte: range.range.start, lt: range.range.endExclusive } },
        select: {
          id: true,
          stage: true,
          createdAt: true,
          updatedAt: true,
          jobRequisition: { select: { department: true } },
        },
      }),
      // A role change whose Clerk sync failed leaves SESS and Clerk disagreeing
      // about someone's privileges — a real, Super-Admin-fixable condition.
      db.auditLog.count({
        where: { action: "USER_ROLE_CLERK_SYNC_FAILED", timestamp: { gte: weekAgo } },
      }),
      moduleToggleValues(),
      // The same live reachability probe the Integrations page uses.
      db
        .$queryRaw`SELECT 1`
        .then(() => true)
        .catch(() => false),
    ]);

    const reportEmployees = employees.map((e) => ({
      id: e.id,
      name: e.name,
      employeeCode: e.employeeCode,
      department: e.department,
      active: e.active,
      joiningDate: e.joiningDate,
      offboardedAt: e.offboardedAt,
    }));

    // Phase 12's function, not a reimplementation.
    const headcount = computeHeadcount(reportEmployees, range.range);
    const funnel = computeRecruitmentFunnel(
      applications.map((a) => ({
        id: a.id,
        department: a.jobRequisition.department,
        stage: a.stage,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })),
    );

    // Six-month trend, using headcountOn() — the same "was employed on this
    // date" rule the reports use, so the dashboard cannot disagree with them.
    const trend = Array.from({ length: 6 }).map((_, i) => {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      // Measure at month END (or today for the current month) so the latest
      // point reflects reality rather than the 1st of the month.
      const measureAt =
        i === 5 ? today : new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
      return {
        month: monthKey(monthStart),
        headcount: headcountOn(reportEmployees, measureAt),
      };
    });

    const submittedRows = submittedPayroll.reduce((n, g) => n + g._count._all, 0);

    return {
      error: null,
      headcount,
      funnel,
      trend,
      roleRows: roleGroups
        .map((g) => ({ role: g.role as Role, count: g._count._all }))
        .sort((a, b) => b.count - a.count),
      totalUsers: roleGroups.reduce((n, g) => n + g._count._all, 0),
      openReqs,
      submittedPayroll,
      submittedRows,
      draftOffers,
      avgAppraisal: appraisalAgg._avg.finalScore,
      appraisalCount: appraisalAgg._count._all,
      audit24h,
      lateToday,
      onLeaveToday,
      openRows,
      syncFailures,
      toggles,
      dbAlive,
    };
  } catch (err) {
    console.error("[admin/dashboard] failed:", err);
    return { error: "System statistics are unavailable right now." as const };
  }
}

export default async function SystemDashboard() {
  const [today, d] = await Promise.all([loadToday(), load()]);

  if (d.error) {
    return (
      <>
        <PageHeader title="System Dashboard" description="Live organisation-wide metrics." />
        <Panel className="flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{d.error}</span>
        </Panel>
      </>
    );
  }

  /**
   * ACTION REQUIRED — every entry below is a real, currently-true condition
   * that a SUPER ADMIN specifically can act on.
   *
   * Deliberately excluded after checking the actual route guards:
   *  · Offers awaiting SENT — /api/hr/offer/status accepts HR too, so it is
   *    not a Super-Admin-only action and belongs on HR's plate.
   *  · Appraisal compute/publish — /api/hr/appraisal/* are HR actions.
   *  · Employee data redaction — HR's retention-review page.
   * Nothing here is a placeholder; if a list is empty the panel says so.
   */
  const actions: { label: string; detail: string; href: string; state: "warn" | "danger" }[] = [];
  if (d.submittedRows > 0) {
    actions.push({
      label: `${d.submittedRows} payroll row${d.submittedRows === 1 ? "" : "s"} awaiting finalize`,
      detail: `Submitted by HR for ${d.submittedPayroll.map((g) => g.month).join(", ")}. Finalizing locks them permanently — only a Super Admin can.`,
      href: "/admin/payroll",
      state: "warn",
    });
  }
  if (d.draftOffers > 0) {
    actions.push({
      label: `${d.draftOffers} offer${d.draftOffers === 1 ? "" : "s"} awaiting approval`,
      detail: "Drafted by HR. An offer cannot be sent to a candidate until a Super Admin approves its figures.",
      href: "/admin/offers",
      state: "warn",
    });
  }
  if (d.syncFailures > 0) {
    actions.push({
      label: `${d.syncFailures} role change${d.syncFailures === 1 ? "" : "s"} failed to sync to Clerk`,
      detail: "SESS and Clerk disagree about someone's privileges. Re-apply the role to retry the sync.",
      href: "/admin/roles",
      state: "danger",
    });
  }
  if (d.openRows > 0) {
    actions.push({
      label: `${d.openRows} attendance record${d.openRows === 1 ? "" : "s"} never clocked out`,
      detail: `Open for more than ${FORGOTTEN_CHECKOUT_HOURS} hours. HR corrects these on Attendance Oversight.`,
      href: "/hr/attendance",
      state: "warn",
    });
  }

  const modulesOn =
    [d.toggles.idleTracking, d.toggles.engagement].filter(Boolean).length +
    (d.toggles.attendanceValidation !== "NONE" ? 1 : 0);

  return (
    <>
      <PageHeader
        title="System Dashboard"
        description="Live organisation-wide metrics. Every figure is a query against real data."
        action={
          <span className="inline-flex items-center gap-2 rounded border border-border px-3 py-1.5">
            <StatusDot state={d.dbAlive ? "good" : "danger"} />
            <span className="text-xs text-text-muted">
              System {d.dbAlive ? "Nominal" : "Degraded"}
            </span>
          </span>
        }
      />

      <TodayWidgets data={today} />

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        <StatCard
          label="Active employees"
          value={d.headcount.totalActive}
          state="good"
          status={`${d.headcount.departmentCount} department${d.headcount.departmentCount === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Open requisitions"
          value={d.openReqs}
          state={d.openReqs > 0 ? "good" : "idle"}
          status={d.openReqs > 0 ? "Accepting applications" : "None open"}
        />
        <StatCard
          label="Payroll awaiting finalize"
          value={d.submittedRows}
          state={d.submittedRows > 0 ? "warn" : "good"}
          status={d.submittedRows > 0 ? "Action required" : "Queue clear"}
        />
        <StatCard
          label="Avg appraisal"
          value={scoreOutOfFive(d.avgAppraisal) ?? "—"}
          unit={d.avgAppraisal == null ? undefined : "/ 5"}
          state={
            d.avgAppraisal == null
              ? "idle"
              : d.avgAppraisal >= 80
                ? "good"
                : d.avgAppraisal >= 60
                  ? "warn"
                  : "danger"
          }
          status={
            d.avgAppraisal == null
              ? "Nothing published"
              : `${d.appraisalCount} published score${d.appraisalCount === 1 ? "" : "s"}`
          }
          mono={d.avgAppraisal != null}
        />
        <StatCard
          label="Audit events (24h)"
          value={d.audit24h}
          state="good"
          status="Full trail in Audit Log"
        />
      </div>

      {/* ── Today: late arrivals + approved leave ── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Late today"
            action={
              <Link href="/hr/attendance" className="text-xs text-accent hover:underline">
                Attendance Oversight →
              </Link>
            }
          />
          {d.lateToday.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-text-muted">
              Nobody has clocked in late today.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {d.lateToday.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-text">{a.employee.name}</div>
                    <div className="font-mono text-[11px] text-text-muted">
                      {a.employee.employeeCode} · {a.employee.department}
                      {a.employee.shift
                        ? ` · ${a.employee.shift.name} ${a.employee.shift.startTime}–${a.employee.shift.endTime}`
                        : " · no shift"}
                    </div>
                  </div>
                  <StatusLabel state="warn" className="shrink-0 font-mono text-xs">
                    {a.lateMinutes != null ? `${a.lateMinutes}m late` : "late"}
                  </StatusLabel>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="On leave today" />
          {d.onLeaveToday.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-text-muted">
              No approved leave covers today.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {d.onLeaveToday.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-text">{l.employee.name}</div>
                    <div className="font-mono text-[11px] text-text-muted">
                      {l.employee.employeeCode} · {l.employee.department}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-text-muted">
                    {ymd(l.startDate)} → {ymd(l.endDate)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ── Headcount trend + department breakdown ── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Headcount — last 6 months" />
          <div className="p-4">
            <HeadcountTrendChart points={d.trend} />
            <p className="mt-2 text-[11px] text-text-muted">
              Measured at each month end (today for the current month), using the
              same employed-on-this-date rule as the Headcount report.
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title={`Headcount by department · ${d.headcount.totalActive}`} />
          <div className="p-4">
            <DepartmentHeadcountChart rows={d.headcount.byDepartment} />
          </div>
        </Panel>
      </div>

      {/* ── Funnel + role distribution ── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Recruitment funnel — last 6 months"
            action={
              <span className="font-mono text-xs text-text-muted">
                {d.funnel.totalApplications} application
                {d.funnel.totalApplications === 1 ? "" : "s"}
              </span>
            }
          />
          <div className="p-4">
            <RecruitmentFunnelChart
              stages={d.funnel.stages.map((s) => ({ stage: s.stage, reached: s.reached }))}
            />
            <p className="mt-2 text-[11px] text-text-muted">
              &quot;Reached&quot; counts applications at or beyond each stage.
              {d.funnel.rejectedCount > 0 &&
                ` ${d.funnel.rejectedCount} rejected application${d.funnel.rejectedCount === 1 ? " is" : "s are"} off-funnel and not shown.`}
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title={`Role distribution · ${d.totalUsers} account${d.totalUsers === 1 ? "" : "s"}`} />
          <div className="p-4">
            <RoleDistributionChart rows={d.roleRows} />
            <p className="mt-2 text-[11px] text-text-muted">
              Linked SESS accounts only. Employees without a login do not appear —
              manage on{" "}
              <Link href="/admin/roles" className="text-accent hover:underline">
                Roles &amp; Permissions
              </Link>
              .
            </p>
          </div>
        </Panel>
      </div>

      {/* ── Action required ── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader
            title="Action required"
            action={
              <span className="font-mono text-xs text-text-muted">
                {actions.length === 0 ? "nothing outstanding" : `${actions.length} item${actions.length === 1 ? "" : "s"}`}
              </span>
            }
          />
          {actions.length === 0 ? (
            <div className="flex items-center gap-3 px-4 py-8">
              <CheckCircle2 size={18} className="shrink-0 text-good" />
              <div>
                <p className="text-sm text-text">Nothing needs your attention</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  No payroll awaiting finalize, no offers awaiting approval, no
                  failed role syncs, no unclosed attendance records.
                </p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {actions.map((a) => (
                <li key={a.label}>
                  <Link
                    href={a.href}
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-raised/50"
                  >
                    <AlertTriangle
                      size={15}
                      className={`mt-0.5 shrink-0 ${a.state === "danger" ? "text-danger" : "text-warn"}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-text">{a.label}</span>
                      <span className="mt-0.5 block text-xs text-text-muted">{a.detail}</span>
                    </span>
                    <ArrowRight size={14} className="mt-1 shrink-0 text-text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="System" />
          <div className="space-y-3 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Database</span>
              <StatusLabel state={d.dbAlive ? "good" : "danger"}>
                {d.dbAlive ? "Reachable" : "Unreachable"}
              </StatusLabel>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Optional modules</span>
              <span className="font-mono text-xs text-text">{modulesOn} / 3 active</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Idle tracking</span>
              <StatusLabel state={d.toggles.idleTracking ? "good" : "idle"}>
                {d.toggles.idleTracking ? "On" : "Off"}
              </StatusLabel>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Punch validation</span>
              <span className="font-mono text-xs text-text">{d.toggles.attendanceValidation}</span>
            </div>
            <p className="border-t border-border pt-3 text-[11px] text-text-muted">
              Status comes from a live <span className="font-mono">SELECT 1</span>{" "}
              against the database on each load — the same probe the{" "}
              <Link href="/admin/integrations" className="text-accent hover:underline">
                Integrations
              </Link>{" "}
              page runs.
            </p>
          </div>
        </Panel>
      </div>

      <div className="mt-4">
        <ImpersonatePanel />
      </div>
    </>
  );
}
