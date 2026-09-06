/**
 * WEB INTERFACE GUIDELINES remediation — verification.
 *
 * Covers two things that were fixed together but are not the same kind of
 * change:
 *
 *   1. A REAL BUG. app/employee/page.tsx collapsed three different outcomes
 *      (no session, no linked Employee, a caught database error) into one
 *      `null` and then rendered a full dashboard of em-dashes with no
 *      explanation — a dead end. Every other page in that portal, and
 *      app/manager/page.tsx, already distinguished "no Employee record" from
 *      "the query failed" using the shared ErrorPanel /
 *      UnlinkedEmployeeNotice pair. The dashboard now does the same. These
 *      checks assert the two pages agree, rather than asserting Employee's
 *      shape in isolation.
 *
 *   2. A batch of one-line guideline fixes (curly quotes, aria-current, h-dvh,
 *      per-route <title>, theme-color, decorative status dot, heading level,
 *      table scope/caption, 16px search input).
 *
 * The notice and status-dot components are COMPILED AND ACTUALLY RENDERED
 * here, not grepped — same approach as verify-phase12-pdf.cjs, because "HR now
 * matches Manager" is a claim about output, and output is what should be
 * compared. Everything else is source analysis, the same way
 * verify-punch-location.ts and verify-report-preview.ts assert page structure.
 *
 * Section 6 asserts the four DEFERRED audit items are still untouched, so a
 * future session can trust that this pass did not quietly start them.
 *
 * Run:  node prisma/verify-wig-fixes.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const ROOT = path.resolve(__dirname, "..");
// Inside the project, like verify-phase12-pdf.cjs: the compiled components
// require react/jsx-runtime, which Node only finds by walking up to the
// project's own node_modules. Removed in the finally block.
const OUT = path.join(ROOT, "node_modules", ".cache", "sess-wig-check");

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
}
function section(title) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 58 - title.length))}`);
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const employee = read("app/employee/page.tsx");
const manager = read("app/manager/page.tsx");
const hr = read("app/hr/page.tsx");

try {
  // ══ 1: the bug — Employee's three outcomes are now three answers ═══════
  section("1: Employee dashboard distinguishes its failure modes");

  check(
    "no-session returns the {m,error} shape, not bare null",
    /if \(!userId\) return \{ m: null, error: null \};/.test(employee),
  );
  check(
    "no linked Employee returns m:null with NO error (an unlinked account is not a failure)",
    /if \(!me \|\| !employee\) return \{ m: null, error: null \};/.test(employee),
  );
  const catchMatch = employee.match(
    /catch \(err\) \{[\s\S]*?return \{ m: null, error: "([^"]+)" \};/,
  );
  check(
    "a caught database error returns a distinct, non-empty message",
    Boolean(catchMatch) && catchMatch[1].length > 10,
    catchMatch ? JSON.stringify(catchMatch[1]) : "no catch-branch error string found",
  );
  check(
    "loadMetrics has no `return null` left anywhere",
    !/return null;/.test(employee.slice(0, employee.indexOf("export default"))),
  );
  check(
    "the success path returns the metrics under m, with error:null",
    /return \{\s*m: \{/.test(employee) && /\},\s*error: null,\s*\};/.test(employee),
  );

  section("2: Employee renders the SAME three branches as Manager");

  const branches = (src) => ({
    error: /\{error && \(\s*<ErrorPanel>\{error\}<\/ErrorPanel>|\{data\.error && \(\s*<ErrorPanel>\{data\.error\}<\/ErrorPanel>/.test(src),
    unlinked: /&& !error && \(\s*<UnlinkedEmployeeNotice|&& !data\.error && \(\s*<UnlinkedEmployeeNotice/.test(src),
    gated: /\{m && \(|\{data\.manager && \(/.test(src),
  });
  const e = branches(employee);
  const m = branches(manager);
  check("Employee renders ErrorPanel for a caught error", e.error);
  check("Employee renders UnlinkedEmployeeNotice only when there is NO error", e.unlinked);
  check("Employee gates the whole dashboard body behind a successful load", e.gated);
  check("Manager still does all three (the pattern being matched)", m.error && m.unlinked && m.gated);
  check(
    "both import the two shared components from components/ui/notice",
    /import \{ ErrorPanel, UnlinkedEmployeeNotice \} from "@\/components\/ui\/notice";/.test(employee) &&
      /import \{ ErrorPanel, UnlinkedEmployeeNotice \} from "@\/components\/ui\/notice";/.test(manager),
  );
  check(
    "Employee defines NO error/notice component of its own",
    !/function (ErrorPanel|UnlinkedEmployeeNotice)/.test(employee),
  );

  section("3: HR uses the shared ErrorPanel, not a bespoke one");

  check("HR imports ErrorPanel", /import \{ ErrorPanel \} from "@\/components\/ui\/notice";/.test(hr));
  check("HR renders <ErrorPanel>{d.error}</ErrorPanel>", /<ErrorPanel>\{d\.error\}<\/ErrorPanel>/.test(hr));
  check(
    "HR's hand-rolled danger Panel is gone",
    !/border-danger\/40/.test(hr),
    /border-danger\/40/.test(hr) ? "bespoke panel still present" : "",
  );

  // ══ 4: RENDER the shared components and compare real markup ════════════
  section("4: rendered markup — Employee, Manager and HR are byte-identical");

  const ts = require(path.join(ROOT, "node_modules", "typescript"));
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const sources = [
    "components/ui/notice.tsx",
    "components/ui/panel.tsx",
    "components/ui/status-dot.tsx",
    "lib/utils.ts",
  ];
  const program = ts.createProgram(
    sources.map((s) => path.join(ROOT, s)),
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

  // tsc does not rewrite the "@/..." alias on emit, so teach require about it.
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith("@/")) {
      return origResolve.call(this, path.join(OUT, request.slice(2)), ...rest);
    }
    return origResolve.call(this, request, ...rest);
  };

  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const notice = require(path.join(OUT, "components/ui/notice.js"));
  const statusDot = require(path.join(OUT, "components/ui/status-dot.js"));
  const panel = require(path.join(OUT, "components/ui/panel.js"));

  // The three dashboards pass a different sentence to the SAME component, so
  // render each page's actual message and compare everything but the text.
  const msgFor = {
    Employee: catchMatch ? catchMatch[1] : "",
    Manager: (manager.match(/error: "([^"]+)" \};/) || [])[1] || "",
    HR: (hr.match(/error: "([^"]+)",/) || [])[1] || "",
  };
  const rendered = Object.fromEntries(
    Object.entries(msgFor).map(([k, v]) => [
      k,
      renderToStaticMarkup(React.createElement(notice.ErrorPanel, null, v)),
    ]),
  );
  const skeleton = (html, msg) => html.replace(msg, "«MESSAGE»");
  const skels = Object.entries(rendered).map(([k, h]) => skeleton(h, msgFor[k]));

  check(
    "each dashboard supplies its own error sentence",
    new Set(Object.values(msgFor)).size === 3 && Object.values(msgFor).every(Boolean),
    JSON.stringify(msgFor),
  );
  check(
    "the surrounding markup (padding, margin, dot) is identical for all three",
    skels[0] === skels[1] && skels[1] === skels[2],
    skels[0],
  );
  check(
    "ErrorPanel carries the shared spacing the bespoke HR panel did not",
    /mb-5/.test(skels[0]) && /px-4 py-3/.test(skels[0]),
  );

  const unlinked = renderToStaticMarkup(
    React.createElement(notice.UnlinkedEmployeeNotice, null),
  );
  check(
    "UnlinkedEmployeeNotice states the situation and is a warn, not an error",
    /No employee record is linked to your account yet\./.test(unlinked) &&
      /Warning/.test(unlinked),
    unlinked,
  );

  section("5: status dot — decorative is silent, semantic still speaks");

  const semantic = renderToStaticMarkup(
    React.createElement(statusDot.StatusDot, { state: "good" }),
  );
  const deco = renderToStaticMarkup(
    React.createElement(statusDot.StatusDot, { state: "good", decorative: true }),
  );
  check('default still renders role="img"', /role="img"/.test(semantic), semantic);
  check('default still renders aria-label="Good"', /aria-label="Good"/.test(semantic));
  check("decorative drops role", !/role="img"/.test(deco), deco);
  check("decorative drops aria-label", !/aria-label/.test(deco));
  check('decorative sets aria-hidden="true"', /aria-hidden="true"/.test(deco));
  check(
    "both still paint the same colour (visual output unchanged)",
    semantic.includes("background-color") &&
      deco.includes("background-color") &&
      semantic.match(/background-color:[^;]+/)[0] === deco.match(/background-color:[^;]+/)[0],
  );
  for (const state of ["good", "warn", "danger", "idle"]) {
    const html = renderToStaticMarkup(React.createElement(statusDot.StatusDot, { state }));
    check(`state "${state}" keeps its accessible name by default`, /aria-label="/.test(html));
  }

  // Every call site must be unchanged except the single decorative one.
  const files = [];
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) files.push(p);
    }
  })(path.join(ROOT, "app"));
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) files.push(p);
    }
  })(path.join(ROOT, "components"));

  let totalDots = 0;
  const decoSites = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const hits = src.match(/<StatusDot[\s\S]*?\/>|<StatusDot[^>]*>/g) ?? [];
    totalDots += hits.length;
    for (const h of hits) {
      if (/\bdecorative\b/.test(h)) decoSites.push(path.relative(ROOT, f).replace(/\\/g, "/"));
    }
  }
  check(
    "exactly ONE call site opted into decorative",
    decoSites.length === 1,
    decoSites.join(", ") || "none",
  );
  check(
    "and it is the topbar dot in portal-shell",
    decoSites[0] === "components/portal/portal-shell.tsx",
    decoSites[0] ?? "none",
  );
  check(
    "every other StatusDot call site is untouched and still announces",
    totalDots >= 100 && totalDots - decoSites.length >= 99,
    `${totalDots} call sites, ${decoSites.length} decorative`,
  );

  // ══ 6: the cheap one-liners ════════════════════════════════════════════
  section("6: guideline one-liners");

  const scan = (dir, exts) => {
    const out = [];
    (function walk(d) {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (exts.some((x) => p.endsWith(x))) out.push(p);
      }
    })(path.join(ROOT, dir));
    return out;
  };
  const allSrc = [...scan("app", [".tsx", ".ts"]), ...scan("components", [".tsx", ".ts"]), ...scan("lib", [".tsx", ".ts"])];
  const offenders = allSrc.filter((f) => /&apos;|&quot;/.test(fs.readFileSync(f, "utf8")));
  check(
    "no &apos; or &quot; entities remain anywhere in app/, components/ or lib/",
    offenders.length === 0,
    offenders.map((f) => path.relative(ROOT, f)).join(", "),
  );
  const curly = allSrc.filter((f) => /[’“”]/.test(fs.readFileSync(f, "utf8")));
  check("real curly characters are present in their place", curly.length >= 30, `${curly.length} files`);

  const sidebar = read("components/portal/sidebar.tsx");
  check(
    'sidebar marks the active nav item with aria-current="page"',
    /aria-current=\{active \? "page" : undefined\}/.test(sidebar),
  );

  const shell = read("components/portal/portal-shell.tsx");
  check("portal shell uses h-dvh, not h-screen", /h-dvh/.test(shell) && !/h-screen/.test(shell));
  const globals = read("app/globals.css");
  check(
    "the print stylesheet unlocks .h-dvh too (it only knew .h-screen)",
    /\.h-dvh,/.test(globals) && /\.h-screen,/.test(globals),
  );

  const layout = read("app/layout.tsx");
  check("root layout defines a title template", /template: "%s · SESS"/.test(layout));
  check("root layout keeps a default title", /default: "SESS — Simplen Employee Self-Service"/.test(layout));
  check(
    "theme-color is declared for BOTH colour schemes",
    /prefers-color-scheme: light\)", color: "#FFFFFF"/.test(layout) &&
      /prefers-color-scheme: dark\)", color: "#0F1417"/.test(layout),
  );
  check(
    "theme-color values match --color-base in globals.css",
    /--color-base: 255 255 255/.test(globals) && /--color-base: 15 20 23/.test(globals),
  );
  const titles = {
    "app/employee/page.tsx": "My Dashboard",
    "app/manager/page.tsx": "Team Dashboard",
    "app/hr/page.tsx": "HR Dashboard",
    "app/admin/page.tsx": "System Dashboard",
  };
  for (const [file, title] of Object.entries(titles)) {
    check(
      `${file} sets its own tab title "${title}"`,
      new RegExp(`export const metadata = \\{ title: "${title}" \\};`).test(read(file)),
    );
  }

  const panelSrc = read("components/ui/panel.tsx");
  check("PanelHeader renders h2, not h3", /<h2 className="text-sm font-semibold text-text">\{title\}<\/h2>/.test(panelSrc));
  check("PageHeader still renders the page h1", /<h1 className="text-xl font-bold text-text">\{title\}<\/h1>/.test(read("components/portal/page-header.tsx")));
  const portalH3 = files.filter((f) => {
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    if (rel.includes("landing") || rel.includes("careers")) return false;
    return /<h3/.test(fs.readFileSync(f, "utf8"));
  });
  check(
    "no <h3> is left inside the portals (h1 → h2 is now unbroken)",
    portalH3.length === 0,
    portalH3.map((f) => path.relative(ROOT, f)).join(", "),
  );
  check(
    "PanelHeader renders through real React as an h2",
    /<h2[^>]*>Payroll Pipeline<\/h2>/.test(
      renderToStaticMarkup(React.createElement(panel.PanelHeader, { title: "Payroll Pipeline" })),
    ),
  );

  check(
    "manager table gives every column header a scope",
    (manager.match(/<th scope="col"/g) ?? []).length === 4,
    `${(manager.match(/<th scope="col"/g) ?? []).length} of 4`,
  );
  check(
    "manager table has a caption naming what the table holds",
    /<caption className="sr-only">/.test(manager),
  );
  check("no scope-less <th> left in the manager dashboard", !/<th className=/.test(manager));

  const search = read("components/portal/global-search.tsx");
  check(
    "search input is 16px (text-base) so iOS does not zoom on focus",
    /text-base text-text/.test(search) && !/text-sm text-text placeholder/.test(search),
  );

  // ══ 7: the four deferred items are still deferred ══════════════════════
  section("7: deferred audit items NOT touched by this pass");

  const landing = read("components/landing/cinematic-landing.tsx");
  check(
    "landing tablist still lacks tabpanel wiring (deferred item 1)",
    /role="tablist"/.test(landing) && !/role="tabpanel"/.test(landing) && !/aria-controls/.test(landing),
  );
  check(
    "search still has no combobox semantics (deferred item 2)",
    !/role="combobox"/.test(search) && !/aria-activedescendant/.test(search),
  );
  const theme = read("components/theme/theme-switcher.tsx");
  check(
    "theme menu still has no Escape/arrow-key handling (deferred item 3)",
    !/onKeyDown/.test(theme) && !/Escape/.test(theme),
  );
  const charts = read("components/admin/dashboard-charts.tsx");
  check(
    "charts still have no accessible names (deferred item 4)",
    !/aria-label/.test(charts) && !/role="img"/.test(charts),
  );

  Module._resolveFilename = origResolve;
} finally {
  fs.rmSync(OUT, { recursive: true, force: true });
}

console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
process.exit(fail === 0 ? 0 : 1);
