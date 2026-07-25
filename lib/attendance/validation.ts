// Attendance punch validation — pure, explicit, and env-driven.
//
// Every branch is handled deliberately (missing geolocation, unconfigured
// allowlist/geofence, out-of-range, late) because the payroll and
// warning-letter state machines in later phases follow this same shape.
//
// A failed validation NEVER drops the punch — the caller still writes the
// Attendance row and records `reviewReason` from `failures` here.

export type ValidationMode = "NONE" | "IP_LOCK" | "GEOFENCE" | "BOTH";

// ─────────────────────────────────────────────────────────────────────────
// OVERNIGHT SHIFTS — the single definition of "which day does this shift
// belong to", used by attendance, time-efficiency and reporting alike.
//
// The company runs two shifts: 09:00–17:00 (day) and 18:00–03:00 (night).
// The night shift crosses midnight, so its check-out lands on the NEXT
// calendar day. THE RULE, applied everywhere: a shift belongs entirely to the
// calendar day it STARTED on. The 18:00–03:00 shift beginning on the 8th is
// the 8th's shift, including the 03:05 punch-out on the 9th.
//
// These helpers are pure so every module agrees by construction rather than
// by each re-deriving the rule and drifting.
// ─────────────────────────────────────────────────────────────────────────

export interface ShiftWindow {
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
}

/** "HH:MM" → minutes since midnight, or null when malformed. */
export function parseHHMM(value: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Does this shift run past midnight? True when the end time is at or before
 * the start time — 18:00→03:00 does, 09:00→17:00 does not.
 *
 * A malformed or missing time answers false: an unparseable shift must not be
 * silently reinterpreted as overnight.
 */
export function shiftCrossesMidnight(shift: ShiftWindow | null | undefined): boolean {
  if (!shift) return false;
  const start = parseHHMM(shift.startTime);
  const end = parseHHMM(shift.endTime);
  if (start === null || end === null) return false;
  return end <= start;
}

/**
 * The calendar day a punch at `at` belongs to, per the rule above.
 *
 * Day shift (and no shift at all): the punch's own date — IDENTICAL to the
 * previous startOfDay() behaviour, so nothing about the 09:00–17:00 case
 * changes.
 *
 * Night shift: a punch in the after-midnight TAIL — from 00:00 up to (not
 * including) the shift's end time — belongs to the PREVIOUS day, because that
 * is when its shift started. A 00:30 arrival for the 18:00–03:00 shift is the
 * 8th's shift, not the 9th's.
 *
 * A punch past the end time (03:05 for an 03:00 end) is outside the shift
 * window and gets its own day. That is deliberate and does not affect
 * check-OUTS, which close the row that is already open — see resolvePunch —
 * and never consult this function. Only a NEW row's date comes from here.
 */
export function shiftDateFor(at: Date, shift: ShiftWindow | null | undefined): Date {
  const ownDay = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  if (!shiftCrossesMidnight(shift)) return ownDay;

  const end = parseHHMM(shift!.endTime);
  if (end === null) return ownDay;

  const minutes = at.getHours() * 60 + at.getMinutes();
  if (minutes < end) {
    return new Date(at.getFullYear(), at.getMonth(), at.getDate() - 1);
  }
  return ownDay;
}

/**
 * How long an open attendance row stays eligible to be closed by the next
 * punch. Longer than any single shift (the night shift is 9h) but comfortably
 * under 24h, so a forgotten check-out is never closed by the NEXT day's
 * arrival — that stale row stays open and visible to HR instead.
 */
export const MAX_OPEN_SHIFT_HOURS = 18;

export type PunchResolution =
  | { action: "CHECK_IN"; shiftDate: Date }
  | { action: "CHECK_OUT"; rowId: string }
  | { action: "ALREADY_COMPLETE"; rowId: string };

/**
 * Decide what a punch means, given the employee's most recent attendance row
 * within the MAX_OPEN_SHIFT_HOURS window.
 *
 * This replaces a lookup keyed on "a row dated today", which could not see the
 * night shift's open row once the clock passed midnight and therefore turned
 * every night-shift check-OUT into a second, bogus check-IN.
 *
 * Keying on the open row rather than on the calendar date makes the two shift
 * patterns behave identically: the day shift's 17:00 punch and the night
 * shift's 03:05 punch both simply close the row that is open.
 */
export function resolvePunch(args: {
  at: Date;
  shift: ShiftWindow | null | undefined;
  /** Most recent row whose checkIn is within MAX_OPEN_SHIFT_HOURS of `at`. */
  recentRow: { id: string; checkIn: Date | null; checkOut: Date | null } | null;
}): PunchResolution {
  const { at, shift, recentRow } = args;

  if (recentRow && recentRow.checkIn) {
    // Open → this punch closes it, whichever calendar day it falls on.
    if (!recentRow.checkOut) return { action: "CHECK_OUT", rowId: recentRow.id };
    // Already closed within the window → a stray third punch for this shift.
    return { action: "ALREADY_COMPLETE", rowId: recentRow.id };
  }

  return { action: "CHECK_IN", shiftDate: shiftDateFor(at, shift) };
}

export interface PunchInput {
  ip: string | null;
  lat: number | null;
  long: number | null;
  /** The moment of the punch. */
  at: Date;
}

export interface ValidationResult {
  /** True only when no validation failure was recorded. */
  passed: boolean;
  /** Human-readable reasons the punch was flagged (empty when passed). */
  failures: string[];
  /** Which checks actually ran, for auditability. */
  checksRun: string[];
}

/** Great-circle distance in metres between two lat/long points. */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000; // Earth radius in metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function readMode(raw: string | undefined): ValidationMode {
  const v = (raw ?? "").trim().toUpperCase();
  if (v === "IP_LOCK" || v === "GEOFENCE" || v === "BOTH") return v;
  // Anything unset/unknown falls back to NONE (no validation) — the caller
  // still records the punch. Misconfiguration must never silently hard-block.
  return "NONE";
}

function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Run IP-lock and/or geofence validation.
 *
 * Phase 11: the mode is now DB-backed (SystemSetting, adjustable from
 * /admin/modules without a redeploy) — callers resolve it via
 * lib/system-settings.ts attendanceValidationMode() and pass it in. When
 * omitted, falls back to the env var, preserving pre-Phase-11 behaviour for
 * any caller not yet updated.
 */
export function validatePunch(input: PunchInput, modeOverride?: ValidationMode): ValidationResult {
  const mode = modeOverride ?? readMode(process.env.ATTENDANCE_VALIDATION_MODE);
  const failures: string[] = [];
  const checksRun: string[] = [];

  if (mode === "NONE") {
    return { passed: true, failures, checksRun: ["none"] };
  }

  const doIp = mode === "IP_LOCK" || mode === "BOTH";
  const doGeo = mode === "GEOFENCE" || mode === "BOTH";

  // ── IP allowlist ────────────────────────────────────────────
  if (doIp) {
    checksRun.push("ip_lock");
    const allowed = (process.env.ALLOWED_IPS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (allowed.length === 0) {
      failures.push("IP validation enabled but ALLOWED_IPS is not configured");
    } else if (!input.ip) {
      failures.push("Request IP address could not be determined");
    } else if (!allowed.includes(input.ip)) {
      failures.push(`IP ${input.ip} is not in the allowlist`);
    }
  }

  // ── Geofence ────────────────────────────────────────────────
  if (doGeo) {
    checksRun.push("geofence");
    const officeLat = parseNumber(process.env.OFFICE_LAT);
    const officeLong = parseNumber(process.env.OFFICE_LONG);
    const radius = parseNumber(process.env.GEOFENCE_RADIUS_METERS);

    if (officeLat === null || officeLong === null || radius === null) {
      failures.push(
        "Geofence validation enabled but OFFICE_LAT/OFFICE_LONG/GEOFENCE_RADIUS_METERS are not fully configured",
      );
    } else if (input.lat === null || input.long === null) {
      failures.push("Geolocation was not provided by the device");
    } else {
      const dist = haversineMeters(
        input.lat,
        input.long,
        officeLat,
        officeLong,
      );
      if (dist > radius) {
        failures.push(
          `Outside geofence: ${Math.round(dist)}m from office (limit ${radius}m)`,
        );
      }
    }
  }

  return { passed: failures.length === 0, failures, checksRun };
}

/**
 * Determine whether a check-in is late relative to WORKDAY_START ("HH:MM").
 * Uses the punch timestamp's local hours/minutes. Returns false when
 * WORKDAY_START is unset or malformed (cannot determine lateness).
 *
 * Phase 6: this is now the FALLBACK only — used when an employee has no
 * assigned shift. Shift-assigned employees use isLateForShift() below.
 */
export function isLateCheckIn(at: Date): boolean {
  const raw = (process.env.WORKDAY_START ?? "").trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return false;
  const cutoff = h * 60 + min;
  const actual = at.getHours() * 60 + at.getMinutes();
  return actual > cutoff;
}

/**
 * Phase 7 shift-based lateness magnitude: minutes past
 * (shift.startTime + gracePeriodMinutes) at check-in.
 *
 * Pure. Returns the positive minutes-late when late, or null when NOT late
 * (on-time/early) or when startTime is malformed (cannot determine). Never
 * returns a negative or zero — those collapse to null. This is the single
 * source of truth; isLateForShift() below is derived from it.
 */
export function lateMinutesForShift(
  at: Date,
  startTime: string,
  gracePeriodMinutes: number,
  /**
   * OPTIONAL, and only meaningful for an overnight shift. Supply the shift's
   * end time and a check-in that falls in the after-midnight tail is measured
   * against the PREVIOUS evening's start rather than being compared to a
   * larger number and declared on time.
   *
   * Without it the function behaves exactly as it always has, so every
   * existing caller and the whole 09:00–17:00 case are untouched.
   */
  endTime?: string,
): number | null {
  const start = parseHHMM(startTime);
  if (start === null) return null;
  const grace = Number.isFinite(gracePeriodMinutes) ? gracePeriodMinutes : 0;
  const cutoff = start + grace;

  let actual = at.getHours() * 60 + at.getMinutes();

  // Night shift, arriving after midnight: 00:30 is not "17.5 hours early" for
  // an 18:00 start, it is 6.5 hours LATE for the shift that began yesterday.
  // Rolling the clock forward a full day expresses that correctly.
  const end = endTime === undefined ? null : parseHHMM(endTime);
  if (end !== null && end <= start && actual < end) {
    actual += 24 * 60;
  }

  const diff = actual - cutoff;
  return diff > 0 ? diff : null; // floored at 0 → null when not late
}

/**
 * Phase 6 shift-based lateness: late when check-in is after
 * shift.startTime + gracePeriodMinutes. Derived from lateMinutesForShift so the
 * boolean and the magnitude can never disagree.
 */
export function isLateForShift(
  at: Date,
  startTime: string,
  gracePeriodMinutes: number,
  endTime?: string,
): boolean {
  return lateMinutesForShift(at, startTime, gracePeriodMinutes, endTime) !== null;
}
