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

async function boolSetting(key: string, defaultValue: boolean): Promise<boolean> {
  const v = await getSetting(key);
  if (v === "true") return true;
  if (v === "false") return false;
  return defaultValue;
}

/** Default ON — the feature existed before the toggle did. */
export function idleTrackingEnabled(): Promise<boolean> {
  return boolSetting(MODULE_KEYS.idleTracking, true);
}

/** Default ON. */
export function engagementEnabled(): Promise<boolean> {
  return boolSetting(MODULE_KEYS.engagement, true);
}

/**
 * Attendance validation mode: DB setting → env var → NONE. The env var keeps
 * working as the deploy-time default; the DB value only overrides once a
 * Super Admin deliberately sets it from the UI.
 */
export async function attendanceValidationMode(): Promise<ValidationMode> {
  const fromDb = await getSetting(MODULE_KEYS.attendanceValidation);
  if (fromDb && (VALIDATION_MODES as string[]).includes(fromDb)) return fromDb as ValidationMode;
  const fromEnv = (process.env.ATTENDANCE_VALIDATION_MODE ?? "").trim().toUpperCase();
  if ((VALIDATION_MODES as string[]).includes(fromEnv)) return fromEnv as ValidationMode;
  return "NONE";
}

/** Current values for the Module Toggles page — three point reads, batched. */
export async function moduleToggleValues(): Promise<{
  idleTracking: boolean;
  engagement: boolean;
  attendanceValidation: ValidationMode;
}> {
  const [idle, engagement, mode] = await Promise.all([
    idleTrackingEnabled(),
    engagementEnabled(),
    attendanceValidationMode(),
  ]);
  return { idleTracking: idle, engagement, attendanceValidation: mode };
}
