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
          The engagement module has been paused by the administrator. Nothing is
          deleted — everything returns when it is switched back on.
        </span>
      </Panel>
    </>
  );
}
