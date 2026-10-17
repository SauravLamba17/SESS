import "server-only";
import { db } from "@/lib/db";
import type { ValidationMode } from "@/lib/attendance/validation";

/**
 * Phase 11 module toggles — stored in the SAME SystemSetting key/value table
 * Phase 10 introduced for the idle threshold (it was already generic; no
 * second settings table). Same resolution philosophy as lib/idle/settings.ts:
 * DB value → env default → hard default, and never throw — a config read
 * failing must not take down the feature it configures.
 *
 * Only genuinely optional features get a key here. Payroll, appraisal and
 * attendance itself are not toggleable, by design.
 */

export const MODULE_KEYS = {
  /** Hard org-wide kill switch — heartbeats rejected regardless of consent. */
  idleTracking: "IDLE_TRACKING_ENABLED",
  /** Punch validation mode, previously env-only (ATTENDANCE_VALIDATION_MODE). */
  attendanceValidation: "ATTENDANCE_VALIDATION_MODE",
  /** Social wall + pulse surveys visibility. */
  engagement: "ENGAGEMENT_ENABLED",
} as const;

export const VALIDATION_MODES: ValidationMode[] = ["NONE", "IP_LOCK", "GEOFENCE", "BOTH"];

/** Raw setting value, or null. Never throws. */
export async function getSetting(key: string): Promise<string | null> {
  try {
    const row = await db.systemSetting.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function boolFrom(v: string | null, defaultValue: boolean): boolean {
  if (v === "true") return true;
  if (v === "false") return false;
  return defaultValue;
}

/** DB value → env var → NONE (see attendanceValidationMode). */
function modeFrom(fromDb: string | null): ValidationMode {
  if (fromDb && (VALIDATION_MODES as string[]).includes(fromDb)) return fromDb as ValidationMode;
  const fromEnv = (process.env.ATTENDANCE_VALIDATION_MODE ?? "").trim().toUpperCase();
  if ((VALIDATION_MODES as string[]).includes(fromEnv)) return fromEnv as ValidationMode;
  return "NONE";
}

/** Default ON — the feature existed before the toggle did. */
export async function idleTrackingEnabled(): Promise<boolean> {
  return boolFrom(await getSetting(MODULE_KEYS.idleTracking), true);
}

/** Default ON. */
export async function engagementEnabled(): Promise<boolean> {
  return boolFrom(await getSetting(MODULE_KEYS.engagement), true);
}

/**
 * Attendance validation mode: DB setting → env var → NONE. The env var keeps
 * working as the deploy-time default; the DB value only overrides once a
 * Super Admin deliberately sets it from the UI.
 */
export async function attendanceValidationMode(): Promise<ValidationMode> {
  return modeFrom(await getSetting(MODULE_KEYS.attendanceValidation));
}

/**
 * Current values for the Module Toggles page and the System Dashboard — all
 * three keys in ONE read. Same resolution and the same never-throw rule as the
 * single-key readers above: a failed read falls back to the defaults.
 *
 * Not cached: the idle kill switch and the validation mode are security
 * configuration, and must take effect the moment a Super Admin changes them.
 */
export async function moduleToggleValues(): Promise<{
  idleTracking: boolean;
  engagement: boolean;
  attendanceValidation: ValidationMode;
}> {
  let rows: { key: string; value: string }[] = [];
  try {
    rows = await db.systemSetting.findMany({
      where: { key: { in: Object.values(MODULE_KEYS) } },
      select: { key: true, value: true },
    });
  } catch {
    // Never throw — defaults below.
  }
  const get = (key: string) => rows.find((r) => r.key === key)?.value ?? null;
  return {
    idleTracking: boolFrom(get(MODULE_KEYS.idleTracking), true),
    engagement: boolFrom(get(MODULE_KEYS.engagement), true),
    attendanceValidation: modeFrom(get(MODULE_KEYS.attendanceValidation)),
  };
}
