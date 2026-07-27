import "server-only";
import { db } from "@/lib/db";

/**
 * System settings that a Super Admin must be able to change from the UI.
 *
 * The codebase's existing convention for config is env vars
 * (ATTENDANCE_VALIDATION_MODE, OFFICE_LAT, …), which is right for values fixed
 * at deploy time. The idle threshold is different: the brief requires it be
 * adjustable "without a code change", and an env var needs a redeploy to
 * change. So it lives in a one-row-per-key table, with the env var kept as the
 * DEFAULT — meaning an untouched install still behaves exactly as configured
 * at deploy, and the DB value only overrides once someone deliberately sets it.
 */

export const IDLE_THRESHOLD_KEY = "IDLE_THRESHOLD_SECONDS";

/** 3.5 minutes, per the specification. */
export const DEFAULT_IDLE_THRESHOLD_SECONDS = 210;

/** Sanity bounds — 30s would be surveillance-grade, an hour would be useless. */
export const MIN_IDLE_THRESHOLD_SECONDS = 60;
export const MAX_IDLE_THRESHOLD_SECONDS = 3600;

function fromEnv(): number {
  const raw = Number.parseInt(process.env.IDLE_THRESHOLD_SECONDS ?? "", 10);
  return Number.isFinite(raw) && raw >= MIN_IDLE_THRESHOLD_SECONDS && raw <= MAX_IDLE_THRESHOLD_SECONDS
    ? raw
    : DEFAULT_IDLE_THRESHOLD_SECONDS;
}

/**
 * The threshold the agent should use, in seconds.
 *
 * Resolution order: DB setting → env var → 210. Never throws — a missing or
 * corrupt setting falls back rather than breaking ingestion, because a
 * heartbeat failing over a config read would lose real data.
 */
export async function idleThresholdSeconds(): Promise<number> {
  try {
    const row = await db.systemSetting.findUnique({ where: { key: IDLE_THRESHOLD_KEY } });
    if (!row) return fromEnv();
    const n = Number.parseInt(row.value, 10);
    return Number.isFinite(n) && n >= MIN_IDLE_THRESHOLD_SECONDS && n <= MAX_IDLE_THRESHOLD_SECONDS
      ? n
      : fromEnv();
  } catch {
    return fromEnv();
  }
}
