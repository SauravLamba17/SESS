import "server-only";

/**
 * Minimal fixed-window IP rate limiter for the PUBLIC application endpoint.
 *
 * ponytail: in-memory Map, per-process. It resets on restart and does not
 * coordinate across instances — upgrade to Redis/Upstash if this ever runs
 * multi-instance. Deliberately not a CAPTCHA: the brief asks for proportionate
 * abuse mitigation at this stage, and a honeypot plus a per-IP cap stops the
 * casual scripted flood that a public form actually attracts.
 */

type Window = { count: number; resetAt: number };

const hits = new Map<string, Window>();

export const RATE_LIMIT_MAX = 5; // applications ...
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // ... per IP per hour

/** Drop expired windows so the Map cannot grow without bound. */
function sweep(now: number) {
  if (hits.size < 1000) return;
  for (const [ip, w] of Array.from(hits.entries())) {
    if (w.resetAt <= now) hits.delete(ip);
  }
}

export interface RateResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(ip: string, now = Date.now()): RateResult {
  sweep(now);
  const existing = hits.get(ip);

  if (!existing || existing.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, retryAfterSeconds: 0 };
  }

  if (existing.count >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX - existing.count,
    retryAfterSeconds: 0,
  };
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
