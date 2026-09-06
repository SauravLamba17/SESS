/**
 * EMPLOYEE DASHBOARD FAILURE PATHS — executed, not asserted.
 *
 * verify-wig-fixes.cjs proves the source has the right shape. This one proves
 * the page BEHAVES: it compiles the real app/employee/page.tsx, runs the real
 * default export, and renders the real JSX to HTML under each of the three
 * outcomes loadMetrics() can produce.
 *
 * HOW THE PATHS ARE TRIGGERED
 * ───────────────────────────
 * Reaching /employee over HTTP needs a Clerk session, and making the route
 * public to fake one would weaken the app's auth for the sake of a test. So
 * the two failure modes are induced at the MODULE BOUNDARY instead: "@/lib/db"
 * and "@/lib/auth" are swapped for stubs via require() interception, exactly
 * as verify-phase12-pdf.cjs swaps in a compiled module tree. The page's own
 * code — its try/catch, its branch conditions, its JSX — is the real thing and
 * runs unmodified. No database is touched and no route is opened.
 *
 *   path A  a signed-in account with no linked Employee row
 *           → UnlinkedEmployeeNotice, no ErrorPanel
 *   path B  the metrics query throws (a genuine database failure)
 *           → ErrorPanel with the page's own sentence, no UnlinkedEmployeeNotice
 *   path C  a healthy load
 *           → neither notice; the dashboard body renders
 *
 * Run:  node prisma/verify-employee-dashboard-fallback.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "node_modules", ".cache", "sess-employee-fallback");

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
}
function section(title) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 56 - title.length))}`);
}

// State the stubs read, flipped per scenario.
const scenario = { mode: "ok" };

async function main() {
 try {
  const ts = require(path.join(ROOT, "node_modules", "typescript"));
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // Compile the page under test plus the two REAL components whose rendering
  // is the thing being verified. Everything else the page imports is stubbed.
  const real = [
    "app/employee/page.tsx",
    "components/ui/notice.tsx",
    "components/ui/panel.tsx",
    "components/ui/status-dot.tsx",
    "lib/utils.ts",
  ];
  const program = ts.createProgram(
    real.map((s) => path.join(ROOT, s)),
    {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      skipLibCheck: true,
      strict: false,
      outDir: OUT,
      rootDir: ROOT,
      noEmitOnError: false,
    },
  );
  program.emit();

  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");

  // A component that renders an identifiable marker, so the assertions below
  // can tell which parts of the page made it into the output.
  const marker = (name) => (props) =>
    React.createElement("div", { "data-stub": name }, props && props.children);

  const REAL_PREFIX = path.join(OUT, "components", "ui");
  const stubs = {
    "@/lib/auth": { getEffectiveUserId: async () => "user_probe" },
    "@/lib/db": {
      db: {
        user: {
          findUnique: async () => {
            if (scenario.mode === "throw") throw new Error("simulated database failure");
            if (scenario.mode === "unlinked") return { id: "u1", employee: null };
            return { id: "u1", employee: { id: "e1", shiftId: "s1" } };
          },
        },
        production: { aggregate: async () => ({ _sum: { unitsProduced: 5 } }) },
        monthlyTarget: { findUnique: async () => ({ targetUnits: 10 }) },
        qualityReport: { aggregate: async () => ({ _avg: { qualityScore: 91 }, _count: { _all: 2 } }) },
        appraisalScore: { findFirst: async () => null },
        consentRecord: { findMany: async () => [] },
        notification: { findMany: async () => [] },
      },
    },
    "@/lib/idle/aggregate": {
      ownIdleTotals: async () => ({
        consent: { active: false },
        today: { totalMinutes: 0, idleMinutes: 0, activeMinutes: 0, activePct: null },
        month: { totalMinutes: 0, activeMinutes: 0, activePct: null },
      }),
      hm: (n) => `${n}m`,
    },
    "@/lib/period": {
      currentPeriod: () => ({
        period: "2026-09",
        monthStart: new Date("2026-09-01"),
        monthEnd: new Date("2026-10-01"),
      }),
    },
    "@/lib/appraisal/display": { scoreOutOfFive: () => null },
    "@/lib/attendance/own-summary": {
      loadOwnAttendance: async () => ({
        today: null,
        weekStart: new Date("2026-08-31"),
        weekByDate: new Map(),
        shift: null,
      }),
    },
    "@/lib/reports/range": { ymd: (d) => "2026-09-06" },
    "@/lib/engagement/today": { loadToday: async () => ({}) },
    "@/components/portal/portal-shell": { PageHeader: marker("PageHeader") },
    "@/components/employee/clock-in-widget": { ClockInWidget: marker("ClockInWidget") },
    "@/components/employee/notification-panel": { NotificationPanel: marker("NotificationPanel") },
    "@/components/engagement/today-widgets": { TodayWidgets: marker("TodayWidgets") },
    "@/components/attendance/own-attendance": {
      ShiftBanner: marker("ShiftBanner"),
      TodayAttendanceCard: marker("TodayAttendanceCard"),
      WeekAttendancePanel: marker("WeekAttendancePanel"),
    },
  };

  const origResolve = Module._resolveFilename;
  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return origLoad.call(this, request, ...rest);
  };
  Module._resolveFilename = function (request, ...rest) {
    // The three components under test resolve to their real compiled output.
    if (request.startsWith("@/components/ui/") || request === "@/lib/utils") {
      const rel = request.slice(2);
      return origResolve.call(this, path.join(OUT, rel), ...rest);
    }
    return origResolve.call(this, request, ...rest);
  };

  const pageMod = require(path.join(OUT, "app/employee/page.js"));
  const EmployeeDashboard = pageMod.default;
  check("the real page module loaded and exports a component", typeof EmployeeDashboard === "function");
  check(
    'the page still declares dynamic = "force-dynamic"',
    pageMod.dynamic === "force-dynamic",
    String(pageMod.dynamic),
  );
  check("the page carries its own tab title", pageMod.metadata && pageMod.metadata.title === "My Dashboard");

  const render = async (mode) => {
    scenario.mode = mode;
    return renderToStaticMarkup(await EmployeeDashboard());
  };

  const UNLINKED = "No employee record is linked to your account yet.";
  const ERRMSG = "Your dashboard figures are unavailable right now.";

  // ── path A ────────────────────────────────────────────────────────────
  section("path A: signed in, no linked Employee record");
  const a = await render("unlinked");
  check("renders the UnlinkedEmployeeNotice", a.includes(UNLINKED));
  check("does NOT render an error panel", !a.includes(ERRMSG));
  check("the dashboard body is withheld (no clock-in widget)", !a.includes('data-stub="ClockInWidget"'));
  check("no stat cards are rendered", !/Production vs Target|Quality Score/.test(a));
  check("the page header still renders, so the user is not on a blank screen", a.includes('data-stub="PageHeader"'));
  check(
    "the notice is a warn, not a critical error",
    /aria-label="Warning"/.test(a) && !/aria-label="Critical"/.test(a),
  );

  // ── path B ────────────────────────────────────────────────────────────
  section("path B: the metrics query throws");
  const b = await render("throw");
  check("renders the ErrorPanel with the page's own sentence", b.includes(ERRMSG));
  check("does NOT claim the account is unlinked", !b.includes(UNLINKED));
  check("the dashboard body is withheld", !b.includes('data-stub="ClockInWidget"'));
  check("the failure is marked critical, not merely a warning", /aria-label="Critical"/.test(b));
  check("the page header still renders", b.includes('data-stub="PageHeader"'));

  // ── path C ────────────────────────────────────────────────────────────
  section("path C: a healthy load still renders the dashboard");
  const c = await render("ok");
  check("neither notice appears", !c.includes(UNLINKED) && !c.includes(ERRMSG));
  check("the clock-in widget renders", c.includes('data-stub="ClockInWidget"'));
  check("the week panel renders", c.includes('data-stub="WeekAttendancePanel"'));
  check("real metrics reach the cards (50% of target)", c.includes("50%"), "production vs target");
  check("the quality figure renders", c.includes("91.0"));
  check("panel titles render as h2 (heading fix holds in a real render)", /<h2[^>]*>Consent &amp; Compliance<\/h2>/.test(c), (c.match(/<h[1-6][^>]*>[^<]*Compliance[^<]*<\/h[1-6]>/) || ["no heading found"])[0]);

  section("the three paths are genuinely different output");
  check("A ≠ B", a !== b);
  check("B ≠ C", b !== c);
  check("A ≠ C", a !== c);

  Module._resolveFilename = origResolve;
  Module._load = origLoad;
 } finally {
  fs.rmSync(OUT, { recursive: true, force: true });
 }
}

main().then(
  () => {
    console.log(`
══ RESULT: ${pass} passed, ${fail} failed ══`);
    process.exit(fail === 0 ? 0 : 1);
  },
  (err) => {
    console.error(err);
    console.log(`
══ RESULT: ${pass} passed, ${fail + 1} failed ══`);
    process.exit(1);
  },
);
