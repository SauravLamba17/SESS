/** Current month as a "YYYY-MM" period string plus its date bounds. */
export function currentPeriod(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  return {
    period: `${y}-${String(m + 1).padStart(2, "0")}`,
    monthStart: new Date(y, m, 1),
    monthEnd: new Date(y, m + 1, 1), // exclusive
  };
}
