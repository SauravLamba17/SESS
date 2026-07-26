import { cn } from "@/lib/utils";

/**
 * SESS mark — a gauge/dial. The arc is the measurement scale; the amber
 * needle points into the "good" zone. Deliberately references measurement,
 * not a generic geometric monogram.
 */
export function LogoMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="SESS gauge mark"
      className={cn("shrink-0", className)}
    >
      {/* Every stroke reads a theme token, so the mark re-colours with the
          app — on the light theme the dial face becomes white with a grey
          rim instead of staying a dark disc in the corner of a white page. */}
      {/* Dial face */}
      <circle
        cx="16"
        cy="16"
        r="15"
        fill="rgb(var(--color-surface))"
        stroke="rgb(var(--color-border))"
      />
      {/* Measurement arc (240°), colour graded left→right */}
      <path
        d="M6.34 24.5A13 13 0 0 1 6.34 7.5"
        stroke="rgb(var(--color-danger))"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M6.34 7.5A13 13 0 0 1 25.66 7.5"
        stroke="rgb(var(--color-text-muted))"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M25.66 7.5A13 13 0 0 1 25.66 24.5"
        stroke="rgb(var(--color-good))"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* Needle into the good zone */}
      <line
        x1="16"
        y1="16"
        x2="22.5"
        y2="10.5"
        stroke="rgb(var(--color-accent))"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Hub */}
      <circle
        cx="16"
        cy="16"
        r="2.4"
        fill="rgb(var(--color-base))"
        stroke="rgb(var(--color-accent))"
        strokeWidth="1.2"
      />
    </svg>
  );
}

export function Logo({
  size = 28,
  showWordmark = true,
  className,
}: {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      {showWordmark && (
        <div className="leading-none">
          <span className="font-display text-lg font-bold tracking-tight text-text">
            SESS
          </span>
          <span className="ml-1.5 hidden text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted sm:inline">
            Self-Service
          </span>
        </div>
      )}
    </div>
  );
}
