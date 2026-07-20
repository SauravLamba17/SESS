/**
 * Display formatting for money and periods.
 *
 * Amounts arrive as exact decimal STRINGS (Decimal.toFixed(2)) and are grouped
 * by string manipulation — deliberately never via Intl.NumberFormat, which
 * would require casting to a JS Number and reintroduce float imprecision on
 * the one surface where a wrong digit is most visible.
 */

/** Indian digit grouping (last 3, then pairs): "1234567.5" → "12,34,567.50". */
export function inr(amount: string): string {
  const [wholeRaw, frac = "00"] = String(amount ?? "0").split(".");
  const neg = wholeRaw.startsWith("-");
  const whole = neg ? wholeRaw.slice(1) : wholeRaw;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest
    ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`
    : last3;
  return `${neg ? "-" : ""}${grouped}.${frac.padEnd(2, "0").slice(0, 2)}`;
}

const MONTH_LABEL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-07" → "July 2026" */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-");
  return `${MONTH_LABEL[Number(m) - 1] ?? m} ${y}`;
}

export const EXPENSE_CATEGORY_LABEL: Record<string, string> = {
  TRAVEL: "Travel",
  FOOD: "Food",
  ACCOMMODATION: "Accommodation",
  COMMUNICATION: "Communication",
  MISCELLANEOUS: "Miscellaneous",
};

export const PAYROLL_STATUS_DOT = {
  DRAFT: "idle",
  SUBMITTED: "warn",
  FINALIZED: "good",
} as const;

export const EXPENSE_STATUS_DOT = {
  PENDING: "warn",
  APPROVED: "good",
  REJECTED: "danger",
} as const;
