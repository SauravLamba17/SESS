import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader, StatCard } from "@/components/ui/panel";
import { StatusLabel } from "@/components/ui/status-dot";

export default function HRDashboard() {
  return (
    <>
      <PageHeader
        title="HR Dashboard"
        description="Organisation-wide attendance, payroll, appraisal and compliance."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active Employees"
          value="248"
          state="good"
          status="6 departments"
        />
        <StatCard
          label="Present Today"
          value="93%"
          state="good"
          status="231 / 248"
        />
        <StatCard
          label="Payroll · 2026-07"
          value="Draft"
          state="warn"
          status="Awaiting submission"
          mono={false}
        />
        <StatCard
          label="Open Warning Letters"
          value="7"
          state="warn"
          status="2 pending release"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Payroll Pipeline" />
          <div className="space-y-3 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-muted">DRAFT (HR editing)</span>
              <StatusLabel state="warn">18 employees</StatusLabel>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">SUBMITTED (to Super Admin)</span>
              <StatusLabel state="idle">230 employees</StatusLabel>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">FINALIZED (locked)</span>
              <StatusLabel state="good">0 employees</StatusLabel>
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
              <span className="text-text-muted">Face-verification consent</span>
              <StatusLabel state="good">246 / 248</StatusLabel>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Idle-tracking consent</span>
              <StatusLabel state="warn">239 / 248</StatusLabel>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Retention expiring &lt; 30d</span>
              <StatusLabel state="danger">4 records</StatusLabel>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
