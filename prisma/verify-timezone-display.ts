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
  // The three server render paths. Each must go through lib/time-display.ts —
  // an unpinned toLocaleTimeString/getHours here is the bug reappearing.
  const paths = [
    "lib/attendance/own-summary.ts",   // Today's Attendance card + This Week panel
    "app/hr/attendance/page.tsx",      // HR Attendance Oversight table + correction form
    "lib/reports/pdf/my-data.tsx",     // My Data PDF export
  ];
  for (const p of paths) {
    const src = fs.readFileSync(path.join(ROOT, p), "utf8");
    check(`${p} imports the shared helper`, /from "(@\/lib\/time-display|.*\/time-display\.ts)"/.test(src));
    // Strip comments first: these files EXPLAIN the bug in prose, and a naive
    // scan matched its own documentation rather than any executable code.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    check(`${p} formats no time with an unpinned local clock`,
      !/toLocaleTimeString\((?![^)]*timeZone)/.test(code) && !/\.getHours\(\)/.test(code));
  }

  step("4", "client-rendered times are left alone (browser TZ is correct)");
  for (const p of ["components/employee/clock-in-widget.tsx", "components/employee/attendance-calendar.tsx"]) {
    const src = fs.readFileSync(path.join(ROOT, p), "utf8");
    check(`${p} is a client component`, /^\s*"use client"/m.test(src));
  }

  step("5", "the card and the widget agree to the minute");
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

const ok = run();

// Re-run under TZ=UTC — the condition that actually produced the bug. Guarded
// so the child does not recurse forever.
if (!process.env.SESS_TZ_CHILD) {
  console.log(`\n${"=".repeat(62)}\nRe-running under TZ=UTC (what Vercel runs)\n${"=".repeat(62)}`);
  const r = spawnSync(
    process.execPath,
    ["--env-file=.env", "prisma/verify-timezone-display.ts"],
    { env: { ...process.env, TZ: "UTC", SESS_TZ_CHILD: "1" }, stdio: "inherit", cwd: ROOT },
  );
  process.exit(ok && r.status === 0 ? 0 : 1);
}

process.exit(ok ? 0 : 1);
