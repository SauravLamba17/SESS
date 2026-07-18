import { auth } from "@clerk/nextjs/server";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { OnboardForm } from "@/components/hr/onboard-form";
import { OffboardButton } from "@/components/hr/offboard-button";
import { getAllEmployees, getActiveEmployees } from "@/lib/data/scope";

export const dynamic = "force-dynamic";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

async function load() {
  const { userId } = await auth();
  if (!userId) return { error: null, employees: [], managers: [] };
  try {
    // Two queries total, both with includes — no per-row lookups.
    const [employees, managers] = await Promise.all([
      getAllEmployees(),
      getActiveEmployees(),
    ]);
    return { error: null, employees, managers };
  } catch (err) {
    console.error("[hr/employees] failed:", err);
    return { error: "Employee data is unavailable right now.", employees: [], managers: [] };
  }
}

export default async function EmployeeMaster() {
  const { error, employees, managers } = await load();
  const activeCount = employees.filter((e) => e.active).length;

  return (
    <>
      <PageHeader
        title="Employee Master"
        description="Onboard and offboard employees. Offboarding is a soft-delete — historical records stay intact."
      />

      {error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{error}</span>
        </Panel>
      )}

      <div className="space-y-6">
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
                    <td colSpan={7} className="px-4 py-8 text-text-muted">
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
