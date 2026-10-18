import { PageHeader } from "@/components/portal/portal-shell";
import { Panel } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";

/** Shown on /community and /pulse when the engagement module is toggled off. */
export function ModulePaused({ title }: { title: string }) {
  return (
    <>
      <PageHeader
        title={title}
        description="This module is currently paused org-wide."
      />
      <Panel className="flex items-center gap-3 px-4 py-6">
        <StatusDot state="idle" />
        <span className="text-sm text-text-muted">
          This feature is paused by your administrator. Nothing has been
          deleted.
        </span>
      </Panel>
    </>
  );
}
