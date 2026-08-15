// Relative + explicit .ts so this resolves under Next's bundler AND under plain
// Node, which the verification suite uses to call register() directly. The "@/"
// alias would only work in the former.
import { ORG_TIME_ZONE } from "./lib/time-display.ts";

/**
 * Pin the server process to the organisation's timezone.
 *
 * ─── WHY THIS FILE EXISTS ────────────────────────────────────────────────
 * The whole attendance domain is written against "server local time == business
 * local time": lateMinutesForShift() reads at.getHours(), the HR correction
 * route builds new Date(y, m, d, h, min), and ~21 other places construct
 * server-local dates. That assumption holds on a developer's IST laptop and
 * fails on Vercel, whose Node runtime is UTC — every punch was evaluated 5h30m
 * early, so lateFlag/lateMinutes were computed wrong and WRITTEN TO THE
 * DATABASE, not merely displayed wrong.
 *
 * The obvious fix — a TZ environment variable — is not available: TZ is a
 * reserved AWS Lambda system variable, so Vercel rejects it. Setting it in code
 * is the supported alternative.
 *
 * ─── WHY `instrumentation.ts` AND NOT next.config / a shared import ──────
 * Next calls register() when a new server instance is bootstrapped, on EACH
 * COLD BOOT, and it must complete before that instance serves its first
 * request. That is exactly the requirement: Vercel runs many independent
 * function instances, and each one re-runs this at its own cold start rather
 * than depending on a single global initialisation that another instance never
 * saw. next.config.mjs is evaluated by the build and by the server bootstrap,
 * but is not a per-instance runtime hook; hanging the assignment off a shared
 * module (lib/db.ts, say) would only cover routes that happen to import it.
 *
 * ─── WHY MUTATING process.env.TZ AT RUNTIME ACTUALLY WORKS ───────────────
 * Node ≥16 forwards a TZ change to V8 as a DateTimeConfigurationChangeNotification,
 * so the zone is re-read rather than cached from process start. Verified on the
 * Node this project runs: with the process started as TZ=UTC, assigning here
 * re-zones both newly created Dates AND ones constructed beforehand. There is
 * therefore no ordering hazard around Dates created before register() runs.
 *
 * ─── EDGE RUNTIME IS DELIBERATELY SKIPPED ────────────────────────────────
 * register() is called in every runtime. The edge runtime has no process
 * timezone to set and ignores TZ, but nothing is lost: middleware.ts is the
 * only edge code here and it does authentication and route matching with no
 * date arithmetic at all (verified — zero Date usage in middleware.ts or the
 * impersonation helper it imports).
 */
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    process.env.TZ = ORG_TIME_ZONE;
  }
}
