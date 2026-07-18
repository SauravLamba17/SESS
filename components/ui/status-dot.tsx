import { cn } from "@/lib/utils";

export type StatusState = "good" | "warn" | "danger" | "idle";

const DOT: Record<StatusState, { color: string; glow: string; label: string }> = {
  good: { color: "#2BB673", glow: "rgba(43,182,115,0.55)", label: "Good" },
  warn: { color: "#F5A623", glow: "rgba(245,166,35,0.55)", label: "Warning" },
  danger: { color: "#E5484D", glow: "rgba(229,72,77,0.55)", label: "Critical" },
  idle: { color: "#8B98A1", glow: "rgba(139,152,161,0.35)", label: "Idle" },
};

/**
 * Signature 7px status dot with a soft glow. Used next to every status
 * label across all four portals — the one recurring motif that ties the
 * product together.
 */
export function StatusDot({
  state,
  className,
}: {
  state: StatusState;
  className?: string;
}) {
  const { color, glow, label } = DOT[state];
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("inline-block shrink-0 rounded-full", className)}
      style={{
        width: 7,
        height: 7,
        backgroundColor: color,
        boxShadow: `0 0 0 1px rgba(0,0,0,0.25), 0 0 6px 1px ${glow}`,
      }}
    />
  );
}

/** Dot + text label, the standard inline status pairing. */
export function StatusLabel({
  state,
  children,
  className,
}: {
  state: StatusState;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm", className)}>
      <StatusDot state={state} />
      <span>{children}</span>
    </span>
  );
}
