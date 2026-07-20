// Attendance punch validation — pure, explicit, and env-driven.
//
// Every branch is handled deliberately (missing geolocation, unconfigured
// allowlist/geofence, out-of-range, late) because the payroll and
// warning-letter state machines in later phases follow this same shape.
//
// A failed validation NEVER drops the punch — the caller still writes the
// Attendance row and records `reviewReason` from `failures` here.

export type ValidationMode = "NONE" | "IP_LOCK" | "GEOFENCE" | "BOTH";

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
 * Run IP-lock and/or geofence validation against env configuration.
 * Reads process.env directly so route handlers stay thin.
 */
export function validatePunch(input: PunchInput): ValidationResult {
  const mode = readMode(process.env.ATTENDANCE_VALIDATION_MODE);
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
): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((startTime ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const grace = Number.isFinite(gracePeriodMinutes) ? gracePeriodMinutes : 0;
  const cutoff = h * 60 + min + grace;
  const actual = at.getHours() * 60 + at.getMinutes();
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
): boolean {
  return lateMinutesForShift(at, startTime, gracePeriodMinutes) !== null;
}
