// Shared Time Efficiency metric: units produced per hour worked.
//
// Pure by design — callers fetch Production + Attendance in batch and pass the
// three values per (employee, date). Keeping it pure lets the manager page
// compute it for every row without an N+1 of per-row DB lookups.

/**
 * Units produced per hour worked for one employee-day.
 * Returns null when there is no usable attendance window (no check-in,
 * still clocked in, or a non-positive duration) — callers show "—", never 0.
 */
export function timeEfficiency(
  unitsProduced: number,
  checkIn: Date | null | undefined,
  checkOut: Date | null | undefined,
): number | null {
  if (!checkIn || !checkOut) return null;
  const hours = (checkOut.getTime() - checkIn.getTime()) / 3_600_000;
  if (hours <= 0) return null;
  return unitsProduced / hours;
}

/** Format an efficiency value for display; null → "—". */
export function formatEfficiency(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}
