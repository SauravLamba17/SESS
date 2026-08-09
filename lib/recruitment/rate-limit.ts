import "server-only";
import { db } from "@/lib/db";

/**
 * IP rate limiter for the PUBLIC application endpoint, backed by Postgres.
 *
 * ─── WHY NOT THE IN-MEMORY MAP THIS REPLACES ─────────────────────────────
 * The previous version kept a per-process Map. That works on a single
 * long-lived server and is worthless on serverless: on Vercel each request may
 * be served by a different, short-lived instance, so a given IP's attempts are
 * scattered across N independent counters that each see a fraction of the
 * traffic and reset on every cold start. A "5 per hour" cap silently became
 * "5 per hour per instance, sometimes reset mid-hour" — i.e. no limit at all.
 *
 * Postgres is the only state every instance already shares, so the counter
 * lives there. No new service, no Redis.
 *
 * Deliberately not a CAPTCHA: the brief asks for proportionate abuse
 * mitigation, and a honeypot plus a per-IP cap stops the casual scripted flood
 * a public form actually attracts.
 */

/** Unchanged from the in-memory version — this was an infrastructure fix. */
export const RATE_LIMIT_MAX = 5; // applications ...
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // ... per IP per hour

/** The only action using this table today; the column exists so it can serve more. */
export const CAREERS_APPLY_ACTION = "careers_apply";

/**
 * How long a row is kept. Anything older than the longest window in use is
 * uncountable by definition, so 24h is generous — it leaves room to lengthen a
 * window later without the sweep having already discarded the evidence.
 */
export const ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface RateResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Count this key's attempts inside the rolling window; record one and allow if
 * under the cap, refuse if at or over it.
 *
 * ─── SLIDING, NOT FIXED, WINDOW ──────────────────────────────────────────
 * The Map version was a FIXED window: the first request started a one-hour
 * clock and the count reset wholesale when it expired. Counting rows by
 * timestamp makes it a SLIDING window instead — each attempt expires exactly
 * an hour after itself. The cap and the window length are unchanged (5 / 1h);
 * what changes is that a caller can no longer burst 5, wait for the clock to
 * flip, and immediately burst 5 more. `retryAfterSeconds` is therefore
 * computed from when the OLDEST attempt in the window ages out, which is the
 * true answer to "when may I try again" rather than an approximation.
 *
 * ─── FAILS OPEN ──────────────────────────────────────────────────────────
 * If the database cannot be reached, this ALLOWS the request. This is
 * abuse-prevention on a public job-application form, not an authorisation
 * gate: no data is exposed and no privilege is granted by letting one through.
 * Weighed against that, a real applicant being turned away during a database
 * hiccup is the worse outcome — they are unlikely to come back. Contrast a
 * setting that guards privileged access, which should fail CLOSED for exactly
 * the opposite reason.
 *
 * The failure is logged so a persistent outage is visible rather than silently
 * removing the limit forever.
 */
export async function checkRateLimit(
  key: string,
  action: string = CAREERS_APPLY_ACTION,
  now: Date = new Date(),
): Promise<RateResult> {
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);

  try {
    const attempts = await db.rateLimitAttempt.findMany({
      where: { key, action, createdAt: { gte: windowStart } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
      // Only the oldest matters for retryAfter, and the count is capped by the
      // limit itself — no need to read an unbounded flood into memory.
      take: RATE_LIMIT_MAX,
    });

    if (attempts.length >= RATE_LIMIT_MAX) {
      const oldest = attempts[0].createdAt.getTime();
      const freesAt = oldest + RATE_LIMIT_WINDOW_MS;
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((freesAt - now.getTime()) / 1000)),
      };
    }

    await db.rateLimitAttempt.create({ data: { key, action } });
    void sweepOldAttempts(now);

    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX - (attempts.length + 1),
      retryAfterSeconds: 0,
    };
  } catch (err) {
    console.error("[rate-limit] check failed; FAILING OPEN and allowing:", err);
    return { allowed: true, remaining: RATE_LIMIT_MAX, retryAfterSeconds: 0 };
  }
}

/**
 * Opportunistic retention sweep — deliberately not a cron job.
 *
 * This app has no background job runner, and adding a scheduler for one DELETE
 * would be more moving parts than the problem deserves. The table only grows
 * when someone applies, so piggy-backing on that same event keeps it bounded
 * without any new infrastructure.
 *
 * Runs at most once per SWEEP_INTERVAL_MS per process, is never awaited by the
 * caller, and swallows its own errors: a failed cleanup must never turn into a
 * failed job application. Worst case on a fleet of cold-starting instances is
 * a few redundant DELETEs of an already-empty range, which the index makes
 * cheap.
 */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
let lastSweptAt = 0;

async function sweepOldAttempts(now: Date): Promise<void> {
  if (now.getTime() - lastSweptAt < SWEEP_INTERVAL_MS) return;
  lastSweptAt = now.getTime();
  try {
    await db.rateLimitAttempt.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - ATTEMPT_RETENTION_MS) } },
    });
  } catch (err) {
    console.error("[rate-limit] retention sweep failed (non-fatal):", err);
  }
}

/**
 * Client IP behind a proxy. Falls back to a constant so a missing header
 * degrades to a shared global bucket (throttled) rather than to no limit.
 */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}
