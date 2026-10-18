import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { BoolToggle, ModeSelect } from "@/components/admin/module-toggles-form";
import { IdleThresholdForm } from "@/components/admin/idle-threshold-form";
import { moduleToggleValues, MODULE_KEYS } from "@/lib/system-settings";
import { idleThresholdSeconds } from "@/lib/idle/settings";

// Tab title for this route; the root layout appends " · SESS".
export const metadata = { title: "Module Toggles" };

export const dynamic = "force-dynamic";

/**
 * Phase 11: the three toggles that exist are the three features with a real
 * reason to be disabled. Payroll, appraisal, attendance itself are not
 * toggleable — turning those "off" is not a configuration, it's an outage.
 * Backed by the SAME SystemSetting table as the Phase 10 idle threshold.
 */
export default async function ModuleToggles() {
  const [values, threshold] = await Promise.all([moduleToggleValues(), idleThresholdSeconds()]);

  return (
    <>
      <PageHeader
        title="Module Toggles"
        description="Turn optional features on or off for everyone. Changes apply immediately."
      />

      <div className="space-y-6">
        <Panel>
          <PanelHeader title="Idle Tracking" />
          <div className="divide-y divide-border">
            <BoolToggle
              settingKey={MODULE_KEYS.idleTracking}
              title="Idle-time tracking (org-wide kill switch)"
              description="When off, idle tracking stops for everyone. Consent records and past data are kept."
              initial={values.idleTracking}
              onLabel="Tracking enabled"
              offLabel="Tracking disabled"
            />
            <div className="px-4 py-4">
              <IdleThresholdForm current={threshold} />
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Attendance Validation" />
          <ModeSelect
            settingKey={MODULE_KEYS.attendanceValidation}
            title="Punch validation mode"
            description="Choose how clock-ins are checked. A failed check is flagged for HR review, never blocked."
            initial={values.attendanceValidation}
          />
        </Panel>

        <Panel>
          <PanelHeader title="Engagement" />
          <BoolToggle
            settingKey={MODULE_KEYS.engagement}
            title="Community wall & pulse surveys"
            description="When paused, the community wall and pulse surveys are hidden. Nothing is deleted."
            initial={values.engagement}
            onLabel="Visible"
            offLabel="Paused"
          />
        </Panel>

        <p className="text-xs text-text-muted">
          Every change is recorded in the audit log.
        </p>
      </div>
    </>
  );
}
