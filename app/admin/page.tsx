import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader, StatCard } from "@/components/ui/panel";
import { StatusLabel } from "@/components/ui/status-dot";

export default function SystemDashboard() {
  return (
    <>
      <PageHeader
        title="System Dashboard"
        description="Platform-wide configuration, machines, audit and the appraisal formula."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Users"
          value="251"
          state="good"
          status="4 roles"
        />
        <StatCard
          label="Modules Enabled"
          value="8 / 9"
          state="warn"
          status="Client-mail AI off"
        />
        <StatCard
          label="Machines Online"
          value="42 / 45"
          state="warn"
          status="3 in maintenance"
        />
        <StatCard
          label="Audit Events (24h)"
          value="1,204"
          state="good"
          status="No anomalies"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Role Distribution" />
          <div className="space-y-3 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-muted">EMPLOYEE</span>
              <span className="font-mono text-text">221</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">MANAGER</span>
              <span className="font-mono text-text">22</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">HR</span>
              <span className="font-mono text-text">6</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">SUPER_ADMIN</span>
              <span className="font-mono text-text">2</span>
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Payroll Finalization Queue" />
          <div className="space-y-3 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Submitted by HR (2026-07)</span>
              <StatusLabel state="idle">230 employees</StatusLabel>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Awaiting finalize/lock</span>
              <StatusLabel state="warn">Action required</StatusLabel>
            </div>
            <p className="pt-2 text-xs text-text-muted">
              Finalizing locks payroll permanently — immutable once done. Only
              Super Admin can perform this action.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
