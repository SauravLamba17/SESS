import { PageHeader } from "@/components/portal/portal-shell";
import { Panel } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";

/**
 * Standard scaffold for a module page whose data flows are wired in a later
 * phase. Renders the header + the role's permission scope for the module,
 * plus any preview content passed as children.
 */
export function ModuleStub({
  title,
  description,
  scope,
  children,
}: {
  title: string;
  description?: string;
  scope: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} description={description} />

      <Panel className="mb-5 flex items-center gap-3 px-4 py-2.5">
        <StatusDot state="idle" />
        <span className="text-xs text-text-muted">
          Access scope for your role:
        </span>
        <span className="font-mono text-xs text-text">{scope}</span>
      </Panel>

      {children ?? (
        <Panel className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <StatusDot state="idle" />
          <p className="text-sm text-text">Module UI scaffolded</p>
          <p className="max-w-md text-xs text-text-muted">
            Data flows for this module are wired in a later phase. Route,
            navigation and role scoping are already in place.
          </p>
        </Panel>
      )}
    </>
  );
}
