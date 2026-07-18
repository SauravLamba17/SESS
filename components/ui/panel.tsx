import { cn } from "@/lib/utils";
import { StatusDot, type StatusState } from "@/components/ui/status-dot";

/** Base surface container — the recurring instrument-panel card. */
export function Panel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded border border-border bg-surface shadow-panel",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  action,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-b border-border px-4 py-3",
        className,
      )}
    >
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {action}
    </div>
  );
}

/** Dashboard stat card, always paired with the signature status dot. */
export function StatCard({
  label,
  value,
  unit,
  state,
  status,
  hint,
  mono = true,
}: {
  label: string;
  value: string | number;
  unit?: string;
  state: StatusState;
  status?: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <Panel className="p-4">
      <div className="flex items-start justify-between">
        <span className="text-xs uppercase tracking-wide text-text-muted">
          {label}
        </span>
        <StatusDot state={state} className="mt-1" />
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span
          className={cn(
            "text-2xl font-semibold text-text",
            mono && "font-mono tabular-nums tracking-tight",
          )}
        >
          {value}
        </span>
        {unit && <span className="text-sm text-text-muted">{unit}</span>}
      </div>
      {(status || hint) && (
        <div className="mt-2 flex items-center justify-between text-xs">
          {status && <span className="text-text-muted">{status}</span>}
          {hint && <span className="font-mono text-text-muted">{hint}</span>}
        </div>
      )}
    </Panel>
  );
}
