import { PageHeader } from "@/components/portal/portal-shell";
import { Panel } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { ReportList } from "@/components/reports/report-list";
import { getCurrentRole } from "@/lib/auth";
import { reportsForRole, scopeFor, type ScopeMode } from "@/lib/reports/registry";
import { currentMonthRange } from "@/lib/reports/range";

/**
 * The reports page body, shared by /manager/reports, /hr/reports and
 * /admin/reports. Each portal's page is a three-line re-export — the list is
 * derived from the caller's EFFECTIVE role against the same registry the API
 * enforces, so the three pages cannot drift from each other or from the server.
 */
export async function ReportsPageBody() {
  const role = await getCurrentRole();
  const available = reportsForRole(role);
  const range = currentMonthRange();

  const scopes: Record<string, Exclude<ScopeMode, "none">> = {};
  for (const r of available) {
    const mode = scopeFor(r, role);
    if (mode !== "none") scopes[r.id] = mode;
  }

  return (
    <>
      <PageHeader
        title="Reports & Analytics"
        description="Generate a PDF report for any period. Every report is scoped to what your role may see."
      />

      {available.length === 0 && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="idle" />
          <span className="text-sm text-text-muted">
            Reports are available to Managers, HR and Super Admin only.
          </span>
        </Panel>
      )}

      <ReportList
        reports={available}
        scopes={scopes}
        defaultStart={range.startLabel}
        defaultEnd={range.endLabel}
      />
    </>
  );
}
