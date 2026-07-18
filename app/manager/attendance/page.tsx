import { auth } from "@clerk/nextjs/server";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { LeaveDecisionButtons } from "@/components/manager/leave-decision-buttons";
import { db } from "@/lib/db";
import { getEmployeeByClerkId, getDirectReports } from "@/lib/data/scope";
import { currentPeriod } from "@/lib/period";

export const dynamic = "force-dynamic";

function fmtDate(d: Date): string {
  return d.toLocaleDateString([], { month: "short", day: "2-digit" });
}

async function load() {
  const { userId } = await auth();
  if (!userId) return { manager: null, error: null };
  try {
    const manager = await getEmployeeByClerkId(userId);
    if (!manager) return { manager: null, error: null };

    const { monthStart, monthEnd } = currentPeriod();
    const [reports, pending, handled, lateGroups] = await Promise.all([
      getDirectReports(manager.id),
      db.leaveRequest.findMany({
        where: { status: "PENDING", employee: { managerId: manager.id, active: true } },
        include: { employee: { select: { name: true, employeeCode: true } } },
        orderBy: { createdAt: "asc" },
      }),
      db.leaveRequest.findMany({
        where: {
          status: { in: ["APPROVED", "REJECTED"] },
          employee: { managerId: manager.id },
        },
        include: { employee: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
      // Single aggregate query — late marks this month across all reports.
      db.attendance.groupBy({
        by: ["employeeId"],
        where: {
          lateFlag: true,
          date: { gte: monthStart, lt: monthEnd },
          employee: { managerId: manager.id },
        },
        _count: { _all: true },
      }),
    ]);

    const lateByEmp = new Map(lateGroups.map((g) => [g.employeeId, g._count._all]));
    return {
      manager,
      error: null,
      reports,
      pending,
      handled,
      lateByEmp,
    };
  } catch (err) {
    console.error("[manager/attendance] failed:", err);
    return { manager: null, error: "Team data is unavailable right now." };
  }
}

export default async function TeamAttendancePage() {
  const data = await load();

  return (
    <>
      <PageHeader
        title="Team Attendance"
        description="Approve leave and review late marks for your direct reports — your reports only."
      />

      {data.error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{data.error}</span>
        </Panel>
      )}

      {!data.manager && !data.error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="warn" />
          <span className="text-sm text-text-muted">
            No employee record is linked to your account yet.
          </span>
        </Panel>
      )}

      {data.manager && (
        <div className="space-y-6">
          {/* Pending leave approvals */}
          <Panel>
            <PanelHeader title={`Pending Leave (${data.pending.length})`} />
            {data.pending.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-8 text-sm text-text-muted">
                <StatusDot state="good" /> Nothing awaiting your approval.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {data.pending.map((lv) => (
                  <li key={lv.id} className="flex items-start justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm text-text">
                        <span>{lv.employee.name}</span>
                        <span className="font-mono text-xs text-text-muted">
                          {lv.employee.employeeCode}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 font-mono text-xs text-text-muted">
                        <span>{fmtDate(lv.startDate)}</span>
                        <span>→</span>
                        <span>{fmtDate(lv.endDate)}</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-text-muted">{lv.reason}</p>
                    </div>
                    <LeaveDecisionButtons id={lv.id} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Recently handled */}
            <Panel>
              <PanelHeader title="Recently Handled" />
              {data.handled.length === 0 ? (
                <div className="px-4 py-8 text-sm text-text-muted">
                  No decisions yet this cycle.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {data.handled.map((lv) => (
                    <li key={lv.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="text-text">{lv.employee.name}</span>
                      <span className="inline-flex items-center gap-2 text-xs">
                        <StatusDot state={lv.status === "APPROVED" ? "good" : "danger"} />
                        <span className="text-text-muted">{lv.status}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {/* Late marks this month */}
            <Panel>
              <PanelHeader title="Late Marks · This Month" />
              <ul className="divide-y divide-border">
                {data.reports.map((r) => {
                  const n = data.lateByEmp.get(r.id) ?? 0;
                  return (
                    <li key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="text-text">{r.name}</span>
                      <span className="inline-flex items-center gap-2">
                        <StatusDot state={n > 0 ? "warn" : "good"} />
                        <span className="font-mono text-text-muted">{n}</span>
                      </span>
                    </li>
                  );
                })}
                {data.reports.length === 0 && (
                  <li className="px-4 py-8 text-sm text-text-muted">No direct reports.</li>
                )}
              </ul>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
