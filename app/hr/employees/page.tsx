import Link from "next/link";
import { ShieldOff } from "lucide-react";
import { getEffectiveUserId } from "@/lib/auth";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { OnboardForm } from "@/components/hr/onboard-form";
import { OffboardButton } from "@/components/hr/offboard-button";
import { BulkImport } from "@/components/hr/bulk-import";
import { InviteButton } from "@/components/hr/invite-button";
import { ShiftAssignSelect } from "@/components/shifts/shift-assign-select";
import { getAllEmployees, getActiveEmployees, getActiveShifts } from "@/lib/data/scope";
import { ErrorPanel } from "@/components/ui/notice";

export const dynamic = "force-dynamic";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

async function load() {
  const userId = await getEffectiveUserId();
  if (!userId) return { error: null, employees: [], managers: [], shifts: [] };
  try {
    // Set-based queries with includes — no per-row lookups.
    const [employees, managers, shifts] = await Promise.all([
      getAllEmployees(),
      getActiveEmployees(),
      getActiveShifts(),
    ]);
    return { error: null, employees, managers, shifts };
  } catch (err) {
    console.error("[hr/employees] failed:", err);
    return { error: "Employee data is unavailable right now.", employees: [], managers: [], shifts: [] };
  }
}

export default async function EmployeeMaster() {
  const { error, employees, managers, shifts } = await load();
  const activeCount = employees.filter((e) => e.active).length;
  const shiftOptions = shifts.map((s) => ({ id: s.id, name: s.name }));

  return (
    <>
      <PageHeader
        title="Employee Master"
        description="Onboard and offboard employees. Offboarding is a soft-delete — historical records stay intact."
        action={
          <Link
            href="/hr/employees/retention-review"
            className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ShieldOff size={13} />
            Data retention review
          </Link>
        }
      />

      {error && (
        <ErrorPanel>{error}</ErrorPanel>
      )}

      <div className="space-y-6">
        <Panel>
          <PanelHeader title="Bulk Import from CSV" />
          <div className="p-4">
            <BulkImport />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Onboard Employee" />
          <div className="p-4">
            <OnboardForm
              managers={managers.map((m) => ({
                id: m.id,
                name: m.name,
                employeeCode: m.employeeCode,
              }))}
            />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title={`Roster · ${activeCount} active / ${employees.length} total`} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-medium">Code</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Department</th>
                  <th className="px-4 py-3 font-medium">Manager</th>
                  <th className="px-4 py-3 font-medium">Joining Date</th>
                  <th className="px-4 py-3 font-medium">Shift</th>
                  <th className="px-4 py-3 font-medium">Login</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {employees.map((e) => (
                  <tr key={e.id} className="hover:bg-surface-raised/50">
                    <td className="px-4 py-3 font-mono text-text-muted">{e.employeeCode}</td>
                    <td className="px-4 py-3 text-text">{e.name}</td>
                    <td className="px-4 py-3 text-text-muted">{e.department}</td>
                    <td className="px-4 py-3 text-text-muted">{e.manager?.name ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-text-muted">{ymd(e.joiningDate)}</td>
                    <td className="px-4 py-3">
                      {e.active ? (
                        <ShiftAssignSelect
                          employeeId={e.id}
                          currentShiftId={e.shiftId}
                          shifts={shiftOptions}
                          endpoint="/api/hr/employee/shift"
                        />
                      ) : (
                        <span className="font-mono text-xs text-text-muted">
                          {e.shift?.name ?? "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {e.user ? (
                        <span className="inline-flex items-center gap-2">
                          <StatusDot state="good" />
                          <span className="text-text-muted">Active account</span>
                        </span>
                      ) : e.pendingInvitationId ? (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-2">
                            <StatusDot state="warn" />
                            <span className="text-text-muted">Invitation sent, awaiting acceptance</span>
                          </span>
                          {e.active && (
                            <InviteButton employeeId={e.id} email={e.email} resend />
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <span className="text-text-muted">No login access</span>
                          {e.active && (
                            <InviteButton employeeId={e.id} email={e.email} resend={false} />
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <StatusDot state={e.active ? "good" : "idle"} />
                        <span className="text-text-muted">{e.active ? "Active" : "Offboarded"}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {e.active && <OffboardButton employeeId={e.id} name={e.name} />}
                    </td>
                  </tr>
                ))}
                {employees.length === 0 && !error && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-text-muted">
                      No employees yet — onboard the first one above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
