/**
 * Clock-time display for SERVER-rendered output.
 *
 * ─── THE BUG THIS EXISTS TO FIX ──────────────────────────────────────────
 * A check-in stored as 2026-08-09T12:28:00Z showed as "05:58 PM" in the Web
 * Attendance widget but "12:28 PM" on the Today's Attendance card beside it —
 * exactly 5h30m apart.
 *
 * Both were running IDENTICAL code:
 *     new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
 *
 * The difference was WHERE it ran. The widget is a "use client" component, so
 * it formats in the browser and picks up the viewer's IST. The card is a server
 * component, so it formats in the Node process — which is IST on a developer's
 * laptop and UTC on Vercel. Same code, two runtimes, two answers, and the bug
 * is invisible in local development.
 *
 * Anything rendered on the server therefore has to name the timezone rather
 * than inherit it. That is all these helpers do.
 *
 * ─── SCOPE, AND WHY BOTH HALVES EXIST ────────────────────────────────────
 * These fix DISPLAY only. The attendance ENGINE was a separate, worse problem:
 * it is built on "server local time == business local time" and reads
 * wall-clock fields directly — lateMinutesForShift() uses at.getHours(),
 * timeOnDay() in the HR correction route builds new Date(y, m, d, h, min), and
 * there are ~21 such server-local date constructions. On a UTC server those
 * computed the wrong lateFlag/lateMinutes and WROTE them to the database; no
 * display helper could ever repair that.
 *
 * That half is now FIXED: instrumentation.ts sets process.env.TZ to
 * ORG_TIME_ZONE on every server cold start, so the engine's server-local
 * arithmetic is business-local arithmetic again. See that file for why the
 * instrumentation hook is the right place for it.
 *
 * These formatters are still the correct approach for anything rendered, and
 * are NOT made redundant by that fix: they name the timezone explicitly rather
 * than inheriting it, so what a user READS stays correct even if the process
 * timezone is ever wrong — a mis-set TZ, a runtime that ignores it, or a
 * future host that does not run instrumentation.ts. Display should not depend
 * on the process being configured correctly. Two independent guarantees, on
 * purpose.
 *
 * Dependency-free on purpose — imported by a React PDF template and by
 * plain-Node verify scripts, neither of which can load Next or Prisma.
 */

/**
 * The organisation's timezone. One definition, so a relocation is one edit.
 * India-only product: ₹ payroll, Form 16, DPDP retention — the whole domain
 * already assumes IST.
 */
export const ORG_TIME_ZONE = "Asia/Kolkata";

/**
 * "05:58 PM" — 12-hour, matching what the client-side Web Attendance widget
 * already renders, so a card and the widget beside it agree to the minute.
 *
 * Locale is left to the environment exactly as before; ONLY the timezone is
 * pinned, so this changes the hour and nothing else about the formatting.
 */
export function formatClock(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: ORG_TIME_ZONE,
  });
}

/**
 * "2026-08-09 12:30:00" — date AND time in the organisation's timezone, for
 * records where the exact moment is the point (the attestation stamp on
 * /employee/documents).
 *
 * Replaces a `toISOString()` that was showing employees their own attestation
 * 5h30m early with no "UTC" label — the same wrong-clock bug as above, just
 * frozen at UTC instead of drifting with the process. "sv-SE" is chosen only
 * because it is the one widely-available locale whose format is already
 * ISO-shaped, so the rendered string keeps exactly the layout it had.
 */
export function formatStamp(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("sv-SE", { timeZone: ORG_TIME_ZONE });
}

/**
 * "17:58" — 24-hour, for dense tables and for the HR correction form, whose
 * value is parsed straight back into a Date. Locale is PINNED to en-GB here
 * (unlike formatClock) because this string is machine-read on the round trip:
 * an en-US "05:58 PM" would not survive the HH:MM parse.
 *
 * Returns null for a missing time so callers can choose their own placeholder,
 * which is the shape the existing hhmm() helper already had.
 */
export function clockHHMM(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: ORG_TIME_ZONE,
  }).format(new Date(d));
}
