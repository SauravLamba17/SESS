/**
 * "6h 30m" from a minute count — the ONE formatter for idle/active durations.
 *
 * Previously there were two, and they disagreed on fractional input:
 * lib/idle/aggregate.ts emitted the raw remainder ("1h 30.7m") while
 * lib/reports/idle-time.ts rounded it ("1h 31m"). Every real caller passes a
 * sum of IdleLog.idleMinutes / activeMinutes, which are Int columns, so the two
 * agreed on every value the app has actually produced — but "agrees in practice"
 * is not a guarantee, and the report PDF and the dashboards must not be able to
 * print different numbers for the same duration.
 *
 * TRUNCATION, deliberately — the decimal is chopped, never rounded up. For an
 * employee-monitoring feature the tie-break belongs on the side that reports
 * slightly LESS idle time, not more. That is the same restraint the rest of
 * this subsystem is built on: no screenshots, no per-application tracking, only
 * two totals a day, and a punctuality model that avoids over-penalising. A
 * formatter that rounded 30.5 idle minutes up to 31 would be picking the other
 * direction for no reason anyone could defend to the person being measured.
 *
 * Lives in its own module because lib/reports/idle-time.ts is pure and must not
 * import lib/idle/aggregate.ts, which queries the database.
 */
export function hm(minutes: number): string {
  if (minutes <= 0) return "0m";
  // Chop first, so the hour and minute parts are both derived from the same
  // truncated total and can never disagree at a boundary (89.9 → 1h 29m).
  const total = Math.floor(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
