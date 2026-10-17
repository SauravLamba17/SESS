// Load-test command runner — the ONLY way anything in scripts/loadtest touches a
// database. It reads .env.loadtest and nothing else, refuses outright if any
// value names the LIVE project, and runs the command in the isolated app copy
// (which contains no .env files, so neither Next nor Prisma can auto-load the
// live connection string).
//
//   node scripts/loadtest/lt-run.mjs [--session] -- <command> [args...]
//
// --session swaps DATABASE_URL for DATABASE_URL_SESSION (port 5432), which
// `prisma migrate deploy` and the seed need; everything else uses the
// transaction-pooler URL exactly as production does.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const LIVE_REF = "ukjzcsvjbvlrhpmjwzfo"; // never, under any flag
const PROJECT = path.resolve(import.meta.dirname, "..", "..");
const APP = process.env.LT_APP_DIR;
if (!APP) throw new Error("LT_APP_DIR (the isolated app copy) must be set");

function parse(file) {
  const env = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"(.*)"$/, "$1");
  }
  return env;
}

const lt = parse(path.join(PROJECT, ".env.loadtest"));
const refOf = (u) => /postgres\.([a-z0-9]+)[:@]/.exec(u ?? "")?.[1] ?? null;
for (const [k, v] of Object.entries(lt))
  if (v.includes(LIVE_REF)) throw new Error(`REFUSING: ${k} in .env.loadtest names the LIVE project`);
const txRef = refOf(lt.DATABASE_URL);
const sessRef = refOf(lt.DATABASE_URL_SESSION);
if (!txRef || txRef !== sessRef) throw new Error(`REFUSING: test URLs disagree (${txRef} vs ${sessRef})`);

const args = process.argv.slice(2);
const session = args[0] === "--session";
const cmd = args.slice(args.indexOf("--") + 1);

// Start from the OS environment minus anything database- or app-shaped, so
// nothing from this shell (or a stray export) can leak in.
const base = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !/^(DATABASE_URL|DIRECT_URL|NEXT_PUBLIC_|CLERK_|DEMO_MODE|ATTENDANCE_|OFFICE_|ALLOWED_IPS|GEOFENCE_|WORKDAY_|IDLE_)/.test(k),
  ),
);
const env = { ...base, ...lt, LT_TEST_REF: txRef };
if (session) env.DATABASE_URL = lt.DATABASE_URL_SESSION;
// LT_SCHEMA=<name>: point at another Postgres schema in the SAME test project
// (used to replay every migration into an empty schema as a rebuild proof).
if (process.env.LT_SCHEMA) {
  const u = new URL(env.DATABASE_URL);
  u.searchParams.set("schema", process.env.LT_SCHEMA);
  env.DATABASE_URL = u.toString();
}
console.error(`[lt-run] test ref=${txRef} mode=${session ? "session:5432" : "transaction:6543"} schema=${process.env.LT_SCHEMA ?? "public"} cwd=${APP}`);

const r = spawnSync(cmd[0], cmd.slice(1), { cwd: APP, env, stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
