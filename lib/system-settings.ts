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
  /** Require a second factor for HR/Super Admin. Defaults OFF — see below. */
  mfaEnforcement: "MFA_ENFORCEMENT_ENABLED",
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
 * Is MFA enforcement switched on? Defaults OFF.
 *
 * ─── WHY THIS DOES NOT USE boolSetting() ─────────────────────────────────
 * boolSetting() leans on getSetting(), which swallows a database error and
 * returns null — indistinguishable from "no row yet". For every other toggle
 * that conflation is harmless, because their default and their failure mode
 * point the same way. Here they point in OPPOSITE directions:
 *
 *   • NO ROW  → the Super Admin has never switched enforcement on → OFF.
 *     This is the documented default and must stay off, or upgrading the app
 *     would silently lock every HR user out of their own portal.
 *
 *   • READ FAILED → we do not know what the org configured. This gate protects
 *     payroll and organisation-wide personal data, so the safe answer to "is
 *     enforcement on?" is YES. FAIL CLOSED, matching lib/mfa.ts's behaviour
 *     when Clerk itself is unreachable.
 *
 * Collapsing those two into one null is exactly how a database blip would
 * disable a security control without anyone noticing, so this reads the row
 * itself rather than going through the shared helper.
 */
export async function mfaEnforcementEnabled(): Promise<boolean> {
  try {
    const row = await db.systemSetting.findUnique({
      where: { key: MODULE_KEYS.mfaEnforcement },
    });
    // Absent row, or any value other than the literal "true", means off.
    return row?.value === "true";
  } catch (err) {
    console.error(
      "[system-settings] could not read MFA_ENFORCEMENT_ENABLED; failing CLOSED (treating enforcement as ON):",
      err,
    );
    return true;
  }
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

/** Current values for the Module Toggles page — point reads, batched. */
export async function moduleToggleValues(): Promise<{
  idleTracking: boolean;
  engagement: boolean;
  attendanceValidation: ValidationMode;
  mfaEnforcement: boolean;
}> {
  const [idle, engagement, mode, mfa] = await Promise.all([
    idleTrackingEnabled(),
    engagementEnabled(),
    attendanceValidationMode(),
    mfaEnforcementEnabled(),
  ]);
  return {
    idleTracking: idle,
    engagement,
    attendanceValidation: mode,
    mfaEnforcement: mfa,
  };
}
