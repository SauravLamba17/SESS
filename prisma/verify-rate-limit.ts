/**
 * DATABASE-BACKED RATE LIMITING for the public careers form.
 *
 * The old implementation kept a per-process Map. On serverless each request may
 * hit a different short-lived instance, so that counted a fraction of the
 * traffic and reset on every cold start — the cap was not enforced at all.
 *
 * This drives the REAL endpoint over HTTP rather than importing the limiter
 * (which is "server-only" because it depends on lib/db). That is the more
 * faithful test anyway: it exercises the actual route, the actual 429, and the
 * actual database.
 *
 * The rate limit runs BEFORE the form is parsed, so an empty POST consumes
 * budget and then 400s — no Candidate or Application rows are ever created.
 *
 * ─── THE RESTART TEST ────────────────────────────────────────────────────
 * Run in two phases around a dev-server restart, which is the closest local
 * approximation of a fresh serverless instance:
 *
 *   npx tsx prisma/verify-rate-limit.ts exhaust   # fill the bucket
 *   <restart the dev server>
 *   npx tsx prisma/verify-rate-limit.ts after-restart
 *
 * `full` runs everything except the restart step.
 *
 * Cleans up every row it writes.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const ROOT = path.resolve(import.meta.dirname, "..");
const BASE = "http://localhost:3005";
const ACTION = "careers_apply";
const TEST_IP = "203.0.113.77";
const OTHER_IP = "203.0.113.99";
const phase = (process.argv[2] ?? "full").toLowerCase();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
}
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, a === e ? "" : `expected ${e}, got ${a}`);
}
function step(n: string, title: string) {
  console.log(`\n── ${n}: ${title} ${"─".repeat(Math.max(0, 46 - title.length))}`);
}

const cleanup = () =>
  db.rateLimitAttempt.deleteMany({ where: { key: { startsWith: "203.0.113." } } });

/** POST an empty body with a spoofed client IP. Consumes rate-limit budget. */
async function apply(ip: string): Promise<{ status: number; code?: string; retryAfter: string | null }> {
  const res = await fetch(`${BASE}/api/careers/apply`, {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: new FormData(),
  });
  let code: string | undefined;
  try {
    code = ((await res.json()) as { code?: string }).code;
  } catch {
    /* non-JSON body is fine */
  }
  return { status: res.status, code, retryAfter: res.headers.get("Retry-After") };
}

const src = fs.readFileSync(path.join(ROOT, "lib/recruitment/rate-limit.ts"), "utf8");
const MAX = Number(/RATE_LIMIT_MAX = (\d+)/.exec(src)?.[1]);

async function staticChecks() {
  step("1", "policy values preserved; in-memory code gone");
  eq("RATE_LIMIT_MAX is still 5", MAX, 5);
  check(
    "RATE_LIMIT_WINDOW_MS is still 1 hour",
    /RATE_LIMIT_WINDOW_MS = 60 \* 60 \* 1000/.test(src),
  );
  check("retention is 24h", /ATTEMPT_RETENTION_MS = 24 \* 60 \* 60 \* 1000/.test(src));
  for (const gone of ["new Map", "hits.get", "hits.set", "resetAt"]) {
    check(`in-memory remnant removed: ${gone}`, !src.includes(gone));
  }
  check("it now reads from the database", src.includes("db.rateLimitAttempt"));

  step("5", "a database failure FAILS OPEN");
  check(
    "the catch block allows rather than refuses",
    /catch[\s\S]{0,240}?FAILING OPEN[\s\S]{0,180}?allowed: true/.test(src),
  );
  check("…and logs, so a persistent outage is visible", /console\.error\("\[rate-limit\]/.test(src));

  step("6", "retention sweep keeps the table bounded");
  check("a sweep exists", src.includes("sweepOldAttempts"));
  check("…deletes by age", /createdAt: \{ lt: /.test(src));
  check("…throttled, not run every request", src.includes("SWEEP_INTERVAL_MS"));
  check("…never awaited by the caller", /void sweepOldAttempts\(/.test(src));
  check("…and has its own catch", /sweepOldAttempts[\s\S]{0,420}?catch/.test(src));

  // Prove a retention delete actually removes an aged row.
  await db.rateLimitAttempt.create({
    data: {
      key: "203.0.113.200",
      action: ACTION,
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    },
  });
  eq("an aged row exists", await db.rateLimitAttempt.count({ where: { key: "203.0.113.200" } }), 1);
  await db.rateLimitAttempt.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  eq(
    "…and a retention delete removes it",
    await db.rateLimitAttempt.count({ where: { key: "203.0.113.200" } }),
    0,
  );

  step("7", "the route still returns the same 429 contract");
  const route = fs.readFileSync(path.join(ROOT, "app/api/careers/apply/route.ts"), "utf8");
  check("awaits the now-async limiter", /await checkRateLimit\(/.test(route));
  check("still 429 + Retry-After", /status: 429/.test(route) && /Retry-After/.test(route));
  check("still the RATE_LIMITED code", route.includes('"RATE_LIMITED"'));
}

async function exhaust() {
  step("2", "the cap is enforced, counting rows in the database");
  await cleanup();

  for (let i = 1; i <= MAX; i++) {
    const r = await apply(TEST_IP);
    check(
      `attempt ${i}/${MAX} passes the limiter (400 = reached form parsing)`,
      r.status === 400,
      `status ${r.status} code ${r.code}`,
    );
  }
  eq(
    "exactly MAX rows recorded in the database",
    await db.rateLimitAttempt.count({ where: { key: TEST_IP, action: ACTION } }),
    MAX,
  );

  const over = await apply(TEST_IP);
  eq(`attempt ${MAX + 1} is REFUSED with 429`, over.status, 429);
  eq("…with code RATE_LIMITED", over.code, "RATE_LIMITED");
  check("…and a Retry-After header", Number(over.retryAfter) > 0, `Retry-After: ${over.retryAfter}`);
  eq(
    "a refused attempt writes NO row (no self-inflicted growth)",
    await db.rateLimitAttempt.count({ where: { key: TEST_IP, action: ACTION } }),
    MAX,
  );

  const other = await apply(OTHER_IP);
  eq("a DIFFERENT IP is unaffected (per-key, not global)", other.status, 400);
}

async function afterRestart() {
  step("3", "THE POINT — the limit survives a process restart");
  const rows = await db.rateLimitAttempt.count({ where: { key: TEST_IP, action: ACTION } });
  check(
    "the database still holds the earlier attempts",
    rows >= MAX,
    `${rows} rows survived the restart`,
  );

  const r = await apply(TEST_IP);
  eq("a fresh server process STILL refuses this IP", r.status, 429);
  eq("…still RATE_LIMITED", r.code, "RATE_LIMITED");
  console.log(
    "        the in-memory version would have allowed this — its Map reset to empty on restart",
  );

  step("4", "attempts age out of the window");
  await db.rateLimitAttempt.updateMany({
    where: { key: TEST_IP, action: ACTION },
    data: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
  });
  const aged = await apply(TEST_IP);
  eq("with every attempt older than 1h, the IP is allowed again", aged.status, 400);
}

async function main() {
  try {
    await fetch(`${BASE}/`);
  } catch {
    console.error(`Dev server not reachable at ${BASE} — start it first.`);
    process.exitCode = 1;
    return;
  }

  if (phase === "exhaust") {
    await staticChecks();
    await exhaust();
    console.log("\n>>> Now RESTART the dev server, then run: … verify-rate-limit.ts after-restart");
    return;
  }
  if (phase === "after-restart") {
    await afterRestart();
    await cleanup();
    return;
  }
  await staticChecks();
  await exhaust();
  await afterRestart();
  await cleanup();
}

main()
  .then(async () => {
    console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
    if (fail > 0) process.exitCode = 1;
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error("VERIFY CRASHED:", e);
    await db.$disconnect();
    process.exitCode = 1;
  });
