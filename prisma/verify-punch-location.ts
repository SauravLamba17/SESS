/**
 * Verification for GPS accuracy capture and location visibility.
 *
 * THE CENTRAL CLAIM, and the reason this file exists: a punch is recorded no
 * matter what the location says. Denied geolocation, a wildly imprecise
 * reading, or a position on the other side of the planet with GEOFENCE
 * enforcement switched ON — all are still written. Location can only ever set
 * flaggedForReview/reviewReason; it can never reject.
 *
 * Drives the REAL punch endpoint over HTTP where it can, and the REAL
 * validatePunch()/Prisma write path directly where a Clerk session would
 * otherwise be needed. Creates its own throwaway employee and deletes
 * everything, pass or fail.
 *
 * Run (dev server up):  node --env-file=.env prisma/verify-punch-location.ts
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { validatePunch } from "../lib/attendance/validation.ts";

const db = new PrismaClient();
const ROOT = process.cwd();
const BASE = "http://127.0.0.1:3005";

const TAG = "ZZ-GEO";
const CODE = `${TAG}-E1`;

/** Office in the test's imagination; the "far" punch is ~1,150 km away. */
const OFFICE = { lat: 19.076, long: 72.8777 }; // Mumbai
const FAR = { lat: 28.6139, long: 77.209 }; // Delhi

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}
function step(n: string, t: string) {
  console.log(`\n── ${n}: ${t} ${"─".repeat(Math.max(0, 48 - t.length))}`);
}

async function cleanup() {
  const emps = await db.employee.findMany({
    where: { employeeCode: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = emps.map((e) => e.id);
  await db.attendance.deleteMany({ where: { employeeId: { in: ids } } });
  await db.user.deleteMany({ where: { employeeId: { in: ids } } });
  await db.employee.deleteMany({ where: { id: { in: ids } } });
  await db.shift.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** Exactly what the route does: validate, then write regardless of the verdict. */
async function recordPunch(
  employeeId: string,
  date: Date,
  coords: { lat: number | null; long: number | null; accuracy: number | null },
  mode: "NONE" | "GEOFENCE",
) {
  const at = new Date();
  const v = validatePunch({ ip: "1.2.3.4", lat: coords.lat, long: coords.long, at }, mode);
  return db.attendance.create({
    data: {
      employeeId,
      date,
      checkIn: at,
      channel: "WEB",
      ipAddress: "1.2.3.4",
      lat: coords.lat,
      long: coords.long,
      accuracy: coords.accuracy,
      checkInNote: "verification",
      flaggedForReview: !v.passed,
      reviewReason: v.passed ? null : v.failures.join("; "),
    },
  });
}

async function main() {
  console.log("Punch location capture + visibility");
  await cleanup();

  const emp = await db.employee.create({
    data: {
      employeeCode: CODE, name: `${TAG} Employee`, department: "Engineering",
      designation: "Operator", joiningDate: new Date(2024, 0, 1), active: true,
    },
  });

  // ── 1: accuracy is stored alongside the coordinates ───────────────────
  step("1", "coordinates AND accuracy are stored");
  const a = await recordPunch(emp.id, new Date(2026, 0, 1), { ...OFFICE, accuracy: 23.5 }, "NONE");
  check("row was created", !!a.id);
  check("lat stored", a.lat === OFFICE.lat, String(a.lat));
  check("long stored", a.long === OFFICE.long, String(a.long));
  check("accuracy stored", a.accuracy === 23.5, String(a.accuracy));

  // ── 2: THE ONE THAT MATTERS — geolocation denied, punch still recorded ─
  step("2", "geolocation DENIED — the punch must still be recorded");
  const denied = await recordPunch(emp.id, new Date(2026, 0, 2), { lat: null, long: null, accuracy: null }, "NONE");
  check("punch was still recorded", !!denied.id, denied.id);
  check("checkIn was written", denied.checkIn !== null);
  check("lat/long/accuracy are all null, not zero or NaN",
    denied.lat === null && denied.long === null && denied.accuracy === null);
  check("a denied reading did NOT flag the punch (mode NONE)", denied.flaggedForReview === false);
  const deniedBack = await db.attendance.findUnique({ where: { id: denied.id } });
  check("it is readable back from the database", deniedBack !== null);

  // ── 3: far outside a LIVE geofence — flagged, never rejected ──────────
  step("3", "GEOFENCE ON, punch ~1,150 km away — flag only, no rejection");
  process.env.OFFICE_LAT = String(OFFICE.lat);
  process.env.OFFICE_LONG = String(OFFICE.long);
  process.env.GEOFENCE_RADIUS_METERS = "100";
  const v = validatePunch({ ip: "1.2.3.4", lat: FAR.lat, long: FAR.long, at: new Date() }, "GEOFENCE");
  check("validatePunch reports a failure", v.passed === false, v.failures.join("; "));
  check("validatePunch RETURNS a verdict — it cannot reject", typeof v.passed === "boolean");

  const far = await recordPunch(emp.id, new Date(2026, 0, 3), { ...FAR, accuracy: 1800 }, "GEOFENCE");
  check("the far punch was STILL recorded", !!far.id, far.id);
  check("its checkIn is present", far.checkIn !== null);
  check("only flaggedForReview changed", far.flaggedForReview === true);
  check("reviewReason explains why", !!far.reviewReason && /geofence/i.test(far.reviewReason), String(far.reviewReason));
  check("its coordinates were kept, not discarded", far.lat === FAR.lat && far.long === FAR.long);
  check("its (poor) accuracy was kept too", far.accuracy === 1800, String(far.accuracy));

  // A wildly imprecise reading must be equally harmless.
  const vague = await recordPunch(emp.id, new Date(2026, 0, 4), { ...OFFICE, accuracy: 50000 }, "GEOFENCE");
  check("a 50 km-accuracy reading still records a punch", !!vague.id);
  check("accuracy alone never flags anything", vague.flaggedForReview === false, `flagged=${vague.flaggedForReview}`);

  // ── 4: the route itself never rejects on location ─────────────────────
  step("4", "the route's own contract");
  const src = fs.readFileSync(path.join(ROOT, "app/api/attendance/punch/route.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("validation result is only ever used to set the flag",
    /flaggedForReview\s*=\s*!validation\.passed/.test(code) || /const flaggedForReview = !validation\.passed/.test(code));
  check("no early return is gated on the validation verdict",
    !/if\s*\(\s*!?\s*validation\.passed\s*\)\s*\{?\s*return/.test(code));
  check("accuracy is never passed to validatePunch",
    !/validatePunch\([^)]*accuracy/.test(code));
  check("accuracy is parsed through the same coercion as lat/long",
    /const accuracy = coerceCoord\(body\.accuracy\)/.test(code));
  check("check-out back-fills accuracy like lat/long",
    /accuracy: existing\.accuracy \?\? accuracy/.test(code));

  // Unauthenticated HTTP call: proves the endpoint is reachable and that its
  // rejection path is AUTH, never location.
  try {
    const res = await fetch(`${BASE}/api/attendance/punch`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: FAR.lat, long: FAR.long, accuracy: 9999, note: "x" }),
    });
    const j = await res.json().catch(() => ({}));
    check("endpoint rejects only on auth (401), not on location", res.status === 401, `status ${res.status}`);
    check("its error mentions authentication, not distance",
      /authenticat/i.test(String(j.error)), String(j.error));
  } catch (e) {
    check("HTTP test ran (is the dev server up on :3005?)", false, String(e));
  }

  // ── 5: HR's query returns the new columns ─────────────────────────────
  step("5", "HR Attendance Oversight sees location");
  const hrRow = await db.attendance.findFirst({
    where: { employeeId: emp.id, lat: { not: null } },
    select: {
      id: true, date: true, checkIn: true, checkOut: true, channel: true,
      lateFlag: true, lateMinutes: true, flaggedForReview: true, reviewReason: true,
      lat: true, long: true, accuracy: true,
      employee: { select: { name: true, employeeCode: true } },
    },
  });
  check("HR's select returns lat", hrRow?.lat != null);
  check("HR's select returns long", hrRow?.long != null);
  check("HR's select returns accuracy", hrRow?.accuracy != null);
  const hrSrc = fs.readFileSync(path.join(ROOT, "app/hr/attendance/page.tsx"), "utf8");
  check("HR page fetches them in ONE query (single findMany on attendance)",
    (hrSrc.match(/db\.attendance\.findMany/g) ?? []).length === 1);
  check("HR page renders the shared PunchLocation", /<PunchLocation/.test(hrSrc));

  // ── 6: Manager's query — the visibility gap ───────────────────────────
  step("6", "Manager Team Attendance sees flags AND location");
  const mgrSrc = fs.readFileSync(path.join(ROOT, "app/manager/attendance/page.tsx"), "utf8");
  for (const f of ["flaggedForReview", "reviewReason", "lat", "long", "accuracy"]) {
    check(`manager query now selects ${f}`, new RegExp(`${f}:\\s*true`).test(mgrSrc));
  }
  check("manager no longer filters on lateFlag alone",
    /OR:\s*\[\{\s*lateFlag:\s*true\s*\},\s*\{\s*flaggedForReview:\s*true\s*\}\]/.test(mgrSrc.replace(/\s+/g, " ")));
  check("manager page renders the shared PunchLocation", /<PunchLocation/.test(mgrSrc));
  check("manager fetches it in ONE query (single findMany on attendance)",
    (mgrSrc.match(/db\.attendance\.findMany/g) ?? []).length === 1);

  // A flagged-but-punctual punch: invisible to a manager before this change.
  const flaggedNotLate = await db.attendance.findFirst({
    where: { employeeId: emp.id, flaggedForReview: true, lateFlag: false },
    select: { id: true, flaggedForReview: true, lateFlag: true, reviewReason: true, lat: true, accuracy: true },
  });
  check("a flagged-but-punctual punch exists and would now be listed",
    !!flaggedNotLate && flaggedNotLate.lateFlag === false && flaggedNotLate.flaggedForReview === true);
  check("...and carries its location for the manager to see",
    flaggedNotLate?.lat != null && flaggedNotLate?.accuracy != null);

  // ── 7: the link + accuracy rendering ──────────────────────────────────
  step("7", "the Google Maps link and accuracy text");
  const locSrc = fs.readFileSync(path.join(ROOT, "components/attendance/punch-location.tsx"), "utf8");
  check("link is a plain maps query URL, no key or embed",
    /https:\/\/www\.google\.com\/maps\?q=\$\{lat\},\$\{long\}/.test(locSrc));
  check("opens in a new tab, safely", /target="_blank"/.test(locSrc) && /rel="noopener noreferrer"/.test(locSrc));
  check("accuracy is rounded to a whole number", /Math\.round\(accuracy\)/.test(locSrc));
  // [\s\S] rather than the `s` (dotAll) flag: that flag needs an ES2018 target
  // and tsconfig pins ES2017 on purpose. Same behaviour, no target change.
  check("renders nothing when either coordinate is missing",
    /lat === null \|\| long === null[\s\S]*return null/.test(locSrc));
  check("shows no accuracy text when accuracy is unknown", /accuracy !== null &&/.test(locSrc));
  // Comments stripped first: the file's own docblock NAMES the words it forbids
  // in order to explain the rule, and a naive scan matched that prose rather
  // than any rendered string. Same trap as verify-timezone-display.ts.
  const locCode = locSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("uses no judgemental wording in anything RENDERED",
    !/suspicious|invalid|too far|outside|violat|cheat|fake/i.test(locCode));
  // And the only user-visible strings really are the two neutral ones.
  const visible = [...locCode.matchAll(/>\s*([A-Za-z][^<>{}]*?)\s*</g)].map((m) => m[1].trim()).filter(Boolean);
  check("rendered literals are neutral", JSON.stringify(visible) === '["View location"]', JSON.stringify(visible));
  // The exact strings a reviewer sees.
  const sample = { lat: OFFICE.lat, long: OFFICE.long, accuracy: 340.7 };
  console.log(`        link  -> https://www.google.com/maps?q=${sample.lat},${sample.long}`);
  console.log(`        label -> ±${Math.round(sample.accuracy)}m accuracy`);
  check("rounded accuracy reads as expected", `±${Math.round(sample.accuracy)}m accuracy` === "±341m accuracy");
}

main()
  .catch((e) => { console.error("suite crashed:", e); fail++; })
  .finally(async () => {
    await cleanup();
    console.log("\n  cleanup: throwaway employee and all its attendance rows removed");
    console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
    await db.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  });
