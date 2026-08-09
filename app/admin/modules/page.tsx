import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { BoolToggle, ModeSelect } from "@/components/admin/module-toggles-form";
import { IdleThresholdForm } from "@/components/admin/idle-threshold-form";
import { moduleToggleValues, MODULE_KEYS } from "@/lib/system-settings";
import { idleThresholdSeconds } from "@/lib/idle/settings";

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
        description="Org-wide switches for the genuinely optional features. Changes apply immediately — no redeploy."
      />

      <div className="space-y-6">
        <Panel>
          <PanelHeader title="Idle Tracking" />
          <div className="divide-y divide-border">
            <BoolToggle
              settingKey={MODULE_KEYS.idleTracking}
              title="Idle-time tracking (org-wide kill switch)"
              description="When off, EVERY desktop-agent heartbeat is rejected regardless of individual consent records or tokens. Agents pause themselves on the rejection. Consent records and historical data are untouched."
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
            description="NONE records every punch unchecked. IP_LOCK checks the office IP allowlist, GEOFENCE checks office coordinates, BOTH checks both. A failing punch is still recorded — it is flagged for HR review, never dropped. Allowlist/coordinates still come from .env; this replaces the redeploy that changing the MODE used to need."
            initial={values.attendanceValidation}
          />
        </Panel>

        <Panel>
          <PanelHeader title="Engagement" />
          <BoolToggle
            settingKey={MODULE_KEYS.engagement}
            title="Community wall & pulse surveys"
            description="When paused, /community and /pulse show a notice and new posts/responses are rejected. Nothing is deleted — everything returns when re-enabled."
            initial={values.engagement}
            onLabel="Visible"
            offLabel="Paused"
          />
        </Panel>

        <p className="text-xs text-text-muted">
          Every change is written to the audit log as{" "}
          <span className="font-mono">MODULE_TOGGLED</span> with the setting and
          new value.
        </p>
      </div>
    </>
  );
}
