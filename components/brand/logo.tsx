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
      {/* Dial face */}
      <circle cx="16" cy="16" r="15" fill="#171D21" stroke="#2A333A" />
      {/* Measurement arc (240°), colour graded left→right */}
      <path
        d="M6.34 24.5A13 13 0 0 1 6.34 7.5"
        stroke="#E5484D"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M6.34 7.5A13 13 0 0 1 25.66 7.5"
        stroke="#8B98A1"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M25.66 7.5A13 13 0 0 1 25.66 24.5"
        stroke="#2BB673"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* Needle into the good zone */}
      <line
        x1="16"
        y1="16"
        x2="22.5"
        y2="10.5"
        stroke="#F5A623"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Hub */}
      <circle cx="16" cy="16" r="2.4" fill="#0F1417" stroke="#F5A623" strokeWidth="1.2" />
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
