/**
 * Verification for server-rendered clock times.
 *
 * THE POINT: this suite re-runs itself in a child process with TZ=UTC, which
 * is what Vercel runs. A developer's laptop is already IST, so the bug this
 * guards against is invisible unless the process timezone is forced — which is
 * exactly why it shipped.
 *
 * A check-in stored at 2026-08-09T12:28:00Z must read 17:58 / 05:58 PM (IST,
 * UTC+5:30) everywhere it is rendered, whatever timezone the server runs in.
 *
 * Run:  node --env-file=.env prisma/verify-timezone-display.ts
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { formatClock, clockHHMM, ORG_TIME_ZONE } from "../lib/time-display.ts";
import { lateMinutesForShift } from "../lib/attendance/validation.ts";
// The REAL hook that ships — not a re-implementation of it.
import { register } from "../instrumentation.ts";

const ROOT = process.cwd();

/** The instant from the bug report: 12:28 UTC == 17:58 IST. */
const INSTANT = new Date("2026-08-09T12:28:00.000Z");
/** Crosses midnight in UTC but not IST — catches date-shift errors too. */
const LATE_NIGHT = new Date("2026-08-09T19:45:00.000Z"); // 01:15 IST on the 10th
/** Night-shift punch-out: 03:05 IST == 21:35 UTC the previous day. */
const NIGHT_OUT = new Date("2026-08-09T21:35:00.000Z"); // 03:05 IST on the 10th

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}
function step(n: string, t: string) {
  console.log(`\n── ${n}: ${t} ${"─".repeat(Math.max(0, 50 - t.length))}`);
}

function run() {
  const tz = process.env.TZ ?? "(inherited)";
  console.log(`Server clock-time display   [process TZ = ${tz}]`);

  step("1", "the helpers themselves");
  check("ORG_TIME_ZONE is IST", ORG_TIME_ZONE === "Asia/Kolkata", ORG_TIME_ZONE);
  check("clockHHMM renders 12:28Z as 17:58 IST", clockHHMM(INSTANT) === "17:58", String(clockHHMM(INSTANT)));
  check("formatClock renders 12:28Z as 05:58 PM-ish",
    /\b05:58\b/.test(formatClock(INSTANT)) && /pm/i.test(formatClock(INSTANT)), formatClock(INSTANT));
  check("clockHHMM handles the IST-next-day case", clockHHMM(LATE_NIGHT) === "01:15", String(clockHHMM(LATE_NIGHT)));
  check("clockHHMM handles a night-shift punch-out", clockHHMM(NIGHT_OUT) === "03:05", String(clockHHMM(NIGHT_OUT)));
  check("null renders as a placeholder, not a crash", clockHHMM(null) === null && formatClock(null) === "—");

  step("2", "the exact offset is +5:30, not a lucky guess");
  const utcHHMM = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
  }).format(INSTANT);
  check("raw UTC reading is 12:28", utcHHMM === "12:28", utcHHMM);
  const [uh, um] = utcHHMM.split(":").map(Number);
  const [ih, im] = clockHHMM(INSTANT)!.split(":").map(Number);
  const deltaMin = (ih * 60 + im) - (uh * 60 + um);
  check("displayed time is exactly 330 minutes ahead of UTC", deltaMin === 330, `${deltaMin} min`);

  step("3", "every server-rendered punch time uses a pinned timezone");
  // The server render paths. Each must go through lib/time-display.ts —
  // an unpinned toLocaleTimeString/getHours here is the bug reappearing.
  const paths = [
    "lib/attendance/own-summary.ts",   // Today's Attendance card + This Week panel
    // The RENDER site. Added because extracting these components for the
    // Manager dashboard moved every punch-time render out from under this
    // guard: own-summary.ts kept the fmtTime re-export and passed, while the
    // file that actually prints the times was checked by nothing.
    "components/attendance/own-attendance.tsx",
    "app/hr/attendance/page.tsx",      // HR Attendance Oversight table + correction form
    "lib/reports/pdf/my-data.tsx",     // My Data PDF export
    "app/employee/documents/page.tsx", // Attestation Record stamp
  ];
  for (const p of paths) {
    const src = fs.readFileSync(path.join(ROOT, p), "utf8");
    // own-summary is allowed as a source because it re-exports formatClock
    // verbatim and is itself on this list — the pin still traces to one place.
    check(`${p} imports the shared helper`,
      /from "(@\/lib\/time-display|.*\/time-display\.ts|@\/lib\/attendance\/own-summary)"/.test(src));
    // Strip comments first: these files EXPLAIN the bug in prose, and a naive
    // scan matched its own documentation rather than any executable code.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    check(`${p} formats no time with an unpinned local clock`,
      !/toLocaleTimeString\((?![^)]*timeZone)/.test(code) && !/\.getHours\(\)/.test(code));
    // The OTHER shape of the same bug, and the one that actually shipped on
    // the documents page: an ISO string dressed up as a wall clock. Always
    // UTC, so it does not drift between dev and prod — it is simply wrong by
    // the offset, every time, with no "UTC" label to warn the reader.
    // Narrow on purpose: toISOString().slice(0, 10) is a legitimate DATE key
    // and stays allowed.
    check(`${p} renders no ISO timestamp as a clock time`,
      !/toISOString\(\)[\s\S]{0,40}?replace\(\s*["']T["']/.test(code));
  }

  step("4", "client-rendered times are left alone (browser TZ is correct)");
  for (const p of ["components/employee/clock-in-widget.tsx", "components/employee/attendance-calendar.tsx"]) {
    const src = fs.readFileSync(path.join(ROOT, p), "utf8");
    check(`${p} is a client component`, /^\s*"use client"/m.test(src));
  }

  step("5", "THE LOGIC BUG: lateness + the correction write path");
  // Display was only half of it. These read WALL-CLOCK FIELDS off a Date, so
  // they follow the process timezone — and their results are written to the
  // database. Under TZ=UTC (Lambda's default) they are wrong; after
  // instrumentation.ts's register() pins the zone, they must be right.
  //
  // 09:42 IST on a 09:00 shift with 10m grace == 32 minutes late.
  const LATE_IST = new Date("2026-08-09T04:12:00.000Z"); // 09:42 IST
  // 01:30 IST — early morning, NOT late for a 09:00 shift. Reads as 20:00 in
  // UTC, which a naive server would call 650 minutes late.
  const EARLY_IST = new Date("2026-08-09T20:00:00.000Z"); // 01:30 IST next day

  const utcNow = process.env.TZ === "UTC";
  const late = lateMinutesForShift(LATE_IST, "09:00", 10, "18:00");
  const early = lateMinutesForShift(EARLY_IST, "09:00", 10, "18:00");

  check("lateMinutesForShift: a 09:42 IST arrival is 32 minutes late",
    late === 32, `got ${late}${utcNow && late !== 32 ? "  <-- the bug: UTC read it as 04:12" : ""}`);
  check("lateMinutesForShift: a 01:30 IST arrival is not flagged late",
    early === null, `got ${early}${utcNow && early !== null ? "  <-- the bug: UTC read it as 20:00" : ""}`);

  // timeOnDay(): the HR correction route rebuilds an instant from an HH:MM the
  // page rendered. Round-tripping 17:58 must land back on 12:28Z, or HR saving
  // an untouched form silently rewrites the punch.
  const day = new Date("2026-08-09T00:00:00.000Z");
  const rebuilt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 17, 58, 0, 0);
  check("timeOnDay: 17:58 rebuilds to 12:28Z (IST), not 17:58Z",
    rebuilt.toISOString().slice(11, 16) === "12:28", rebuilt.toISOString());

  step("6", "the card and the widget agree to the minute");
  // The widget formats in the browser (IST for this org); the card now formats
  // with the timezone pinned. Same instant must give the same clock reading.
  const widgetInBrowser = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: ORG_TIME_ZONE,
  }).format(INSTANT);
  check("widget (browser, IST) and card (server, pinned) match",
    widgetInBrowser === clockHHMM(INSTANT), `${widgetInBrowser} vs ${clockHHMM(INSTANT)}`);

  console.log(`\n══ RESULT [TZ=${tz}]: ${pass} passed, ${fail} failed ══`);
  return fail === 0;
}

if (!process.env.SESS_TZ_CHILD) {
  // ── PARENT: the developer's own machine (IST). ──
  const ok = run();

  console.log(`\n${"=".repeat(64)}`);
  console.log("Re-running as Vercel does: TZ=UTC, NEXT_RUNTIME=nodejs");
  console.log(`${"=".repeat(64)}`);
  const r = spawnSync(
    process.execPath,
    ["--env-file=.env", "prisma/verify-timezone-display.ts"],
    {
      // TZ=UTC is Lambda's default; NEXT_RUNTIME=nodejs is what Next sets, and
      // is the branch register() actually keys off.
      env: { ...process.env, TZ: "UTC", NEXT_RUNTIME: "nodejs", SESS_TZ_CHILD: "1" },
      stdio: "inherit",
      cwd: ROOT,
    },
  );
  process.exit(ok && r.status === 0 ? 0 : 1);
}

// ── CHILD: booted exactly like a Vercel function, before register() runs. ──
console.log("Simulating a Vercel cold boot   [process TZ = UTC]\n");

step("0", "the bug is REAL before register() — the test discriminates");
{
  const late = lateMinutesForShift(new Date("2026-08-09T04:12:00.000Z"), "09:00", 10, "18:00");
  const early = lateMinutesForShift(new Date("2026-08-09T20:00:00.000Z"), "09:00", 10, "18:00");
  const d = new Date("2026-08-09T00:00:00.000Z");
  const rebuilt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 17, 58, 0, 0);
  // These assert the WRONG answers on purpose. If any of them stops holding,
  // the simulation is no longer reproducing Vercel and everything below it is
  // proving nothing.
  check("un-pinned: a genuinely 32-min-late arrival is missed entirely", late === null, `got ${late}`);
  check("un-pinned: an on-time 01:30 IST arrival is falsely 650 min late", early === 650, `got ${early}`);
  check("un-pinned: HR's 17:58 would be written back as 17:58Z",
    rebuilt.toISOString().slice(11, 16) === "17:58", rebuilt.toISOString());
  check("un-pinned: process really is UTC", new Date().getTimezoneOffset() === 0);
}

step("0b", "register() — the real hook from instrumentation.ts");
register();
check("register() set process.env.TZ", process.env.TZ === "Asia/Kolkata", String(process.env.TZ));
check("V8 picked the change up (offset is now IST, -330)",
  new Date().getTimezoneOffset() === -330, String(new Date().getTimezoneOffset()));

const ok = run();
process.exit(ok ? 0 : 1);
