import { MapPin } from "lucide-react";

/**
 * Where a punch was recorded, and how precise that reading was.
 *
 * ONE definition, rendered identically by HR's Attendance Oversight and the
 * Manager's Team Attendance page — the same reason ShiftBanner/TodayAttendanceCard
 * are shared rather than copied.
 *
 * ─── DELIBERATELY NEUTRAL ────────────────────────────────────────────────
 * This states a fact and nothing more. No wording about being "outside",
 * "suspicious", "invalid" or "too far", and no colour that implies fault — the
 * link is `accent` and the accuracy is `text-muted`, NOT the `danger` red used
 * for reviewReason next to it, because a coordinate is information, not an
 * accusation. Whether a punch was flagged is decided elsewhere, by
 * lib/attendance/validation.ts, and is displayed separately.
 *
 * Showing the accuracy is the honest half: a 20 m rooftop fix and a 2 km
 * cell-tower fix look identical on a map pin, and a reviewer who cannot tell
 * them apart will over-read the pin. Where accuracy is unknown we print
 * nothing rather than invent a number.
 *
 * Renders NOTHING when either coordinate is missing — geolocation being denied
 * is normal and never blocks a punch, so there is no broken link and no empty
 * pin for those rows.
 *
 * A plain Google Maps query URL on purpose: no map library, no embed, no API
 * key, no third-party script on the page. The coordinates only leave the app if
 * a reviewer actively clicks.
 */
export function PunchLocation({
  lat,
  long,
  accuracy,
  className = "",
}: {
  lat: number | null;
  long: number | null;
  accuracy: number | null;
  className?: string;
}) {
  if (lat === null || long === null) return null;

  return (
    // `flex`, NOT `inline-flex`: as an inline element this ran straight on from
    // the status text beside it ("On time" + "View location" with no gap), and
    // the mt-0.5 both callers pass was silently inert. Block-level flex drops it
    // onto its own line under the status, matching the reviewReason block that
    // sits directly above it. Still a <span> so it stays valid inside the
    // Manager page's <span> wrapper.
    // `mt-1.5` lives HERE, not at the call sites: the separation from the
    // status text above is a property of this component, so both pages get the
    // same gap without either remembering to pass one.
    <span className={`mt-1.5 flex flex-wrap items-center gap-2 ${className}`}>
      <a
        href={`https://www.google.com/maps?q=${lat},${long}`}
        target="_blank"
        rel="noopener noreferrer"
        // The small-pill convention already used across the app (see the late
        // chips on this same Manager page and the role chip in the topbar):
        // rounded + border-border + bg-surface-raised. `hover:border-accent` is
        // the same affordance the HR correction buttons use. Accent text, since
        // amber marks every interactive accent element in this UI.
        className="inline-flex items-center gap-1 rounded border border-border bg-surface-raised px-2 py-0.5 text-accent transition-colors hover:border-accent"
      >
        <MapPin size={11} strokeWidth={2} className="shrink-0" />
        View location
      </a>
      {accuracy !== null && (
        // Subordinate on purpose: no border, no background, muted colour, so it
        // reads as a footnote to the button rather than a second control.
        <span className="font-mono text-text-muted">
          ±{Math.round(accuracy)}m accuracy
        </span>
      )}
    </span>
  );
}
