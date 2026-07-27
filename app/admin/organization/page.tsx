import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { db } from "@/lib/db";
import { departmentSummary } from "@/lib/admin/organization";
import { ErrorPanel } from "@/components/ui/notice";

export const dynamic = "force-dynamic";

/**
 * Phase 11: READ-ONLY organizational view. Departments are derived from
 * Employee.department strings and manager oversight from Employee.managerId —
 * no new data, no Department model (see lib/admin/organization.ts for why).
 * Rename/merge is deliberately NOT built: it means bulk-reassigning employee
 * strings with knock-on effects on formulas and requisitions — future work.
 */
async function load() {
  try {
    // ONE query for the whole page, active employees with manager joined.
    const employees = await db.employee.findMany({
      where: { active: true },
      select: {
        id: true,
        department: true,
        managerId: true,
        manager: { select: { name: true, active: true } },
      },
    });
    const summary = departmentSummary(
      employees.map((e) => ({
        id: e.id,
        department: e.department,
        managerId: e.managerId,
        managerName: e.manager?.name ?? null,
      })),
    );
    return { summary, total: employees.length, error: null };
  } catch (err) {
    console.error("[admin/organization] failed:", err);
    return { summary: [], total: 0, error: "Organization data is unavailable right now." };
  }
}

export default async function OrganizationPage() {
  const { summary, total, error } = await load();

  return (
    <>
      <PageHeader
        title="Organization"
        description="Departments in use, headcount and manager oversight — derived from live employee records. Read-only."
      />

      {error && (
        <ErrorPanel>{error}</ErrorPanel>
      )}

      <Panel>
        <PanelHeader title={`Departments · ${summary.length} in use · ${total} active employees`} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium">Headcount</th>
                <th className="px-4 py-3 font-medium">Managers overseeing employees here</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {summary.map((d) => (
                <tr key={d.department} className="hover:bg-surface-raised/50">
                  <td className="px-4 py-3 text-text">{d.department}</td>
                  <td className="px-4 py-3 font-mono text-text">{d.headcount}</td>
                  <td className="px-4 py-3 text-text-muted">
                    {d.managers.length > 0 ? d.managers.join(", ") : "— none assigned —"}
                  </td>
                </tr>
              ))}
              {summary.length === 0 && !error && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-text-muted">No active employees.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-4 py-3 text-xs text-text-muted">
          Departments are free-text values on employee records (set at
          onboarding). Renaming or merging a department would mean reassigning
          every employee&apos;s record — flagged as future work, not a quick edit.
        </p>
      </Panel>
    </>
  );
}
