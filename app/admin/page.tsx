import Link from "next/link";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader, StatCard } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { ImpersonatePanel } from "@/components/admin/impersonate-panel";
import { TodayWidgets } from "@/components/engagement/today-widgets";
import { loadToday } from "@/lib/engagement/today";
import { db } from "@/lib/db";
import { moduleToggleValues } from "@/lib/system-settings";
import type { Role } from "@/lib/auth-types";

export const dynamic = "force-dynamic";

/**
 * Phase 11: every number on this dashboard is a live aggregate — the
 * hardcoded placeholder cards from Phase 0 are gone. One Promise.all of
 * count/aggregate queries; nothing here scales with headcount.
 */
async function loadStats() {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    const [roleGroups, activeEmployees, openReqs, submittedPayroll, avgAppraisal, audit24h, toggles] =
      await Promise.all([
        db.user.groupBy({ by: ["role"], _count: { _all: true } }),
        db.employee.count({ where: { active: true } }),
        db.jobRequisition.count({ where: { status: "OPEN" } }),
        db.payroll.groupBy({
          by: ["month"],
          where: { status: "SUBMITTED" },
          _count: { _all: true },
        }),
        db.appraisalScore.aggregate({
          where: { excluded: false, finalScore: { not: null }, cycle: { published: true } },
          _avg: { finalScore: true },
          _count: { _all: true },
        }),
        db.auditLog.count({ where: { timestamp: { gte: dayAgo } } }),
        moduleToggleValues(),
      ]);

    const roleCounts = new Map(roleGroups.map((g) => [g.role as Role, g._count._all]));
    const totalUsers = roleGroups.reduce((sum, g) => sum + g._count._all, 0);
    const submittedRows = submittedPayroll.reduce((sum, g) => sum + g._count._all, 0);

    return {
      roleCounts,
      totalUsers,
      activeEmployees,
      openReqs,
      submittedPayroll, // per-month breakdown
      submittedRows,
      avgAppraisal: avgAppraisal._avg.finalScore,
      appraisalCount: avgAppraisal._count._all,
      audit24h,
      toggles,
      error: null,
    };
  } catch (err) {
    console.error("[admin/dashboard] stats failed:", err);
    return null;
  }
}

export default async function SystemDashboard() {
  const [today, stats] = await Promise.all([loadToday(), loadStats()]);

  const modulesOn = stats
    ? [stats.toggles.idleTracking, stats.toggles.engagement].filter(Boolean).length +
      (stats.toggles.attendanceValidation !== "NONE" ? 1 : 0)
    : 0;

  return (
    <>
      <PageHeader
        title="System Dashboard"
        description="Live cross-module aggregates, impersonation testing and links to full configuration."
      />

      <TodayWidgets data={today} />

      <ImpersonatePanel />

      {!stats && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">System statistics are unavailable right now.</span>
        </Panel>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total Accounts"
              value={String(stats.totalUsers)}
              state="good"
              status={`${stats.activeEmployees} active employees`}
            />
            <StatCard
              label="Open Requisitions"
              value={String(stats.openReqs)}
              state={stats.openReqs > 0 ? "good" : "idle"}
              status={stats.openReqs > 0 ? "Accepting applications" : "None open"}
            />
            <StatCard
              label="Payroll Awaiting Finalize"
              value={String(stats.submittedRows)}
              state={stats.submittedRows > 0 ? "warn" : "good"}
              status={stats.submittedRows > 0 ? "Submitted by HR — action required" : "Queue clear"}
            />
            <StatCard
              label="Avg Appraisal (published)"
              value={stats.avgAppraisal == null ? "—" : stats.avgAppraisal.toFixed(1)}
              state={
                stats.avgAppraisal == null
                  ? "idle"
                  : stats.avgAppraisal >= 80
                    ? "good"
                    : stats.avgAppraisal >= 60
                      ? "warn"
                      : "danger"
              }
              status={
                stats.avgAppraisal == null
                  ? "Nothing published yet"
                  : `${stats.appraisalCount} scores org-wide`
              }
              mono={stats.avgAppraisal != null}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard
              label="Audit Events (24h)"
              value={String(stats.audit24h)}
              state="good"
              status="View the full trail in Audit Log"
            />
            <StatCard
              label="Optional Modules Active"
              value={`${modulesOn} / 3`}
              state={modulesOn === 3 ? "good" : "warn"}
              status={[
                `Idle tracking ${stats.toggles.idleTracking ? "on" : "OFF"}`,
                `validation ${stats.toggles.attendanceValidation}`,
                `engagement ${stats.toggles.engagement ? "on" : "OFF"}`,
              ].join(" · ")}
              mono={false}
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel>
              <PanelHeader title="Role Distribution" />
              <div className="space-y-3 p-4 text-sm">
                {(["EMPLOYEE", "MANAGER", "HR", "SUPER_ADMIN"] as Role[]).map((r) => (
                  <div key={r} className="flex items-center justify-between">
                    <span className="text-text-muted">{r}</span>
                    <span className="font-mono text-text">{stats.roleCounts.get(r) ?? 0}</span>
                  </div>
                ))}
                <p className="pt-2 text-xs text-text-muted">
                  Manage on{" "}
                  <Link href="/admin/roles" className="text-accent hover:underline">
                    Roles &amp; Permissions
                  </Link>
                  .
                </p>
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Payroll Finalization Queue" />
              <div className="space-y-3 p-4 text-sm">
                {stats.submittedPayroll.length === 0 ? (
                  <p className="text-text-muted">No submitted runs are waiting. </p>
                ) : (
                  stats.submittedPayroll.map((g) => (
                    <div key={g.month} className="flex items-center justify-between">
                      <span className="font-mono text-text-muted">{g.month}</span>
                      <span className="font-mono text-text">{g._count._all} rows submitted</span>
                    </div>
                  ))
                )}
                <p className="pt-2 text-xs text-text-muted">
                  Finalizing locks payroll permanently — immutable once done.{" "}
                  <Link href="/admin/payroll" className="text-accent hover:underline">
                    Go to Payroll Finalization
                  </Link>
                  .
                </p>
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
