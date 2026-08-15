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
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      <a
        href={`https://www.google.com/maps?q=${lat},${long}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent underline underline-offset-2 hover:opacity-80"
      >
        View location
      </a>
      {accuracy !== null && (
        <span className="font-mono text-text-muted">
          ±{Math.round(accuracy)}m accuracy
        </span>
      )}
    </span>
  );
}
