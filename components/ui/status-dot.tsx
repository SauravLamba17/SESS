import { cn } from "@/lib/utils";

export type StatusState = "good" | "warn" | "danger" | "idle";

/**
 * Colours come from the theme tokens, not literal hexes, so the dot re-colours
 * with the rest of the app. The glow reuses the same channel triplet at
 * --dot-glow-alpha, which each theme tunes (subtler on light, stronger on
 * high-contrast).
 */
const DOT: Record<StatusState, { token: string; label: string }> = {
  good: { token: "--color-good", label: "Good" },
  warn: { token: "--color-warn", label: "Warning" },
  danger: { token: "--color-danger", label: "Critical" },
  idle: { token: "--color-text-muted", label: "Idle" },
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
  const { token, label } = DOT[state];
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("inline-block shrink-0 rounded-full", className)}
      style={{
        width: 7,
        height: 7,
        backgroundColor: `rgb(var(${token}))`,
        boxShadow: `0 0 0 1px rgb(0 0 0 / 0.25), 0 0 6px 1px rgb(var(${token}) / var(--dot-glow-alpha))`,
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
