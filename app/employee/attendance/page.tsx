import { getEffectiveUserId } from "@/lib/auth";
import type { LeaveStatus } from "@prisma/client";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot, type StatusState } from "@/components/ui/status-dot";
import { LeaveForm } from "@/components/employee/leave-form";
import { AttendanceCalendar } from "@/components/employee/attendance-calendar";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { UnlinkedEmployeeNotice } from "@/components/ui/notice";

export const dynamic = "force-dynamic";

const LEAVE_STATE: Record<LeaveStatus, StatusState> = {
  PENDING: "warn",
  APPROVED: "good",
  REJECTED: "danger",
};

function fmtDate(d: Date): string {
  return d.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

async function loadOwnLeave() {
  const userId = await getEffectiveUserId();
  if (!userId) return { employeeLinked: false as const, leaves: [], error: null, shift: null };
  try {
    const employee = await getEmployeeByClerkId(userId);
    if (!employee)
      return { employeeLinked: false as const, leaves: [], error: null, shift: null };
    // Own requests + assigned shift.
    const [leaves, shift] = await Promise.all([
      db.leaveRequest.findMany({
        where: { employeeId: employee.id },
        orderBy: { createdAt: "desc" },
      }),
      employee.shiftId
        ? db.shift.findUnique({ where: { id: employee.shiftId } })
        : Promise.resolve(null),
    ]);
    return { employeeLinked: true as const, leaves, error: null, shift };
  } catch (err) {
    console.error("[my-attendance] load leave failed:", err);
    return {
      employeeLinked: true as const,
      leaves: [],
      error: "Leave history is unavailable right now.",
      shift: null,
    };
  }
}

export default async function MyAttendancePage() {
  const now = new Date();
  const { employeeLinked, leaves, error, shift } = await loadOwnLeave();

  return (
    <>
      <PageHeader
        title="My Attendance"
        description="Punch history, month calendar and leave requests — your own records only."
      />

      {!employeeLinked && (
        <UnlinkedEmployeeNotice>No employee record is linked to your account yet. Attendance and
            leave will appear once HR completes onboarding.</UnlinkedEmployeeNotice>
      )}

      {employeeLinked && (
        <Panel className="mb-5 flex items-center gap-2 px-4 py-2.5 text-sm">
          <StatusDot state={shift ? "good" : "warn"} />
          <span className="text-text-muted">Your shift:</span>
          {shift ? (
            <span className="font-mono text-text">
              {shift.name} · {shift.startTime}–{shift.endTime}
              {shift.gracePeriodMinutes > 0 ? ` (+${shift.gracePeriodMinutes}m grace)` : ""} — check in
              after this is marked late
            </span>
          ) : (
            <span className="text-text-muted">not assigned — ask HR</span>
          )}
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Calendar */}
        <Panel className="p-4">
          <AttendanceCalendar
            initialYear={now.getFullYear()}
            initialMonth={now.getMonth() + 1}
          />
        </Panel>

        {/* Leave apply + own list */}
        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Apply for Leave" />
            <div className="p-4">
              <LeaveForm />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="My Leave Requests" />
            {error ? (
              <div className="flex items-center gap-2 px-4 py-4 text-sm text-danger">
                <StatusDot state="danger" />
                <span>{error}</span>
              </div>
            ) : leaves.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <StatusDot state="idle" />
                <p className="text-sm text-text">No leave requests yet</p>
                <p className="text-xs text-text-muted">
                  Submitted requests appear here with their approval status.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {leaves.map((lv) => (
                  <li
                    key={lv.id}
                    className="flex items-start justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-mono text-sm text-text">
                        <span>{fmtDate(lv.startDate)}</span>
                        <span className="text-text-muted">→</span>
                        <span>{fmtDate(lv.endDate)}</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-text-muted">
                        {lv.reason}
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-2 text-xs">
                      <StatusDot state={LEAVE_STATE[lv.status]} />
                      <span className="text-text-muted">{lv.status}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
