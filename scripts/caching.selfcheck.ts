/**
 * Self-check for the SESS caching strategy. No test framework — run it
 * directly, the same way lib/payroll/compute.selfcheck.ts runs:
 *
 *   node --import ./scripts/alias-loader.mjs ./scripts/caching.selfcheck.ts
 *
 * It needs a built .next (for the cache directory) and a reachable DATABASE_URL.
 *
 * WHAT IT ACTUALLY EXERCISES
 * The modules under test are imported unmodified — the same lib/cache/*.ts and
 * lib/invalidation/*.ts the app imports, calling the same Next `unstable_cache`
 * and `revalidateTag`, backed by Next's own IncrementalCache and its own
 * on-disk FileSystemCache handler (scripts/cache-harness.ts). Nothing about the
 * caching is simulated. Cache hits are observed as ABSENT PRISMA QUERIES, not
 * as a return value that happens to match: the shared PrismaClient is created
 * here with query events enabled and handed to lib/db.ts through the
 * hot-reload global it already reuses, so every query any module under test
 * issues is counted at the driver.
 *
 * WHAT IT WRITES TO THE DATABASE
 * Two disposable things, both removed in a finally block that runs even on
 * failure, and both reported line by line as they happen:
 *   · one Holiday row named "ZZ-CACHE-SELFCHECK" (created, then deleted);
 *   · one LeaveRequest for an existing employee, plus a temporary managerId on
 *     that same employee (restored to its original value afterwards).
 * It writes nothing to payroll, salary, audit or Clerk.
 */
import { PrismaClient } from "@prisma/client";

// ── The shared client, with query events on ─────────────────────────────────
// lib/db.ts reuses globalThis.prisma when present (its hot-reload guard), so
// setting it here BEFORE importing anything makes `db` in every module under
// test the very client whose queries are counted below.
const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
(globalThis as unknown as { prisma: PrismaClient }).prisma = client;

let queryCount = 0;
client.$on("query", () => {
  queryCount++;
});

/** Queries issued since the last call. Query events arrive asynchronously, so
 *  settle first — otherwise a hit and a miss are indistinguishable by timing. */
async function queries(): Promise<number> {
  await new Promise((r) => setTimeout(r, 250));
  const n = queryCount;
  queryCount = 0;
  return n;
}

const { db } = await import("@/lib/db");
const { request, forceCold } = await import("./cache-harness.ts");

const { getDepartments, TAG_DEPARTMENTS } = await import("@/lib/cache/departments.ts");
const { getHolidayCalendar, TAG_HOLIDAYS, TAG_SHIFTS } = await import("@/lib/cache/shifts.ts");
const {
  getHrDashboardTotals,
  getPendingLeaveCount,
  DASHBOARD_TTL,
  TAG_HR_DASHBOARD,
  TAG_MANAGER_DASHBOARD,
  TAG_RECRUITMENT,
  TAG_APPRAISALS,
  approvalsTag,
} = await import("@/lib/cache/dashboard.ts");
const { TAG_ROSTER } = await import("@/lib/cache/employees.ts");
const { onEmployeeRosterChanged, onHolidayCalendarChanged } = await import(
  "@/lib/invalidation/employee.ts"
);
const { onLeaveDecided } = await import("@/lib/invalidation/leave.ts");
const { onAttendanceRecorded } = await import("@/lib/invalidation/attendance.ts");
const { currentPeriod } = await import("@/lib/period.ts");
const { ymd } = await import("@/lib/reports/range.ts");

// ── Assertions ──────────────────────────────────────────────────────────────
let failures = 0;
let section = "";

function heading(title: string) {
  section = title;
  console.log(`\n${"─".repeat(74)}\n${title}\n${"─".repeat(74)}`);
}

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
}

function eq(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok, ok ? "" : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── Static analysis helpers (used by the RED-tier section) ──────────────────
const { readFileSync, existsSync, statSync } = await import("node:fs");
const nodePath = await import("node:path");

const ROOT = process.cwd();

/** Every import specifier in a source file. */
function importsOf(src: string): string[] {
  const out: string[] = [];
  const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

/** Resolve a project-local import to a file on disk, or null for a package. */
function resolveLocal(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = nodePath.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = nodePath.resolve(nodePath.dirname(fromFile), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every project file reachable from `entry` by imports — its whole call path. */
function importClosure(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [nodePath.join(ROOT, entry)];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const spec of importsOf(src)) {
      const local = resolveLocal(file, spec);
      if (local) stack.push(local);
    }
  }
  return [...seen];
}

/**
 * Every SHARED caching mechanism, per the strategy document's Section 1 list.
 *
 * React cache() is deliberately not in this list. Section 1 classes it as a
 * per-render dedupe for "duplicate reads during one server render", not a
 * shared cache: it holds nothing between requests and cannot serve one user's
 * value to another. It is detected separately below, so its single deliberate
 * use (lib/auth.ts) is reported as a stated exception rather than either
 * failing the check or passing unseen.
 */
const CACHE_MARKERS: [string, RegExp][] = [
  ["Next.js Data Cache", /\bunstable_cache\b/],
  ["Next.js cache import", /from\s+["']next\/cache["']/],
  ["'use cache' directive", /["']use cache["']/],
  ["lib/cache/ import", /@\/lib\/cache\//],
  ["fetch cache option", /cache:\s*["'](force-cache|default)["']/],
  ["fetch next.revalidate", /next:\s*\{[^}]*revalidate/],
  ["route segment revalidate", /^\s*export\s+const\s+revalidate\s*=/m],
  ["Redis", /\b(redis|ioredis|upstash)\b/i],
];

/** §1's per-render memo — permitted, but reported wherever it appears. */
const REACT_CACHE = /^\s*import\s*\{[^}]*\bcache\b[^}]*\}\s*from\s*["']react["']/m;

function cacheMarkersIn(file: string): string[] {
  const src = readFileSync(file, "utf8");
  // Strip comments — this file set is heavily commented ABOUT caching, and a
  // comment saying "never cache" must not be read as caching.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  return CACHE_MARKERS.filter(([, re]) => re.test(code)).map(([name]) => name);
}

// ─────────────────────────────────────────────────────────────────────────────
const period = currentPeriod().period;
const todayYmd = ymd(new Date());

const ALL_TAGS = [
  TAG_DEPARTMENTS,
  TAG_HOLIDAYS,
  TAG_SHIFTS,
  TAG_ROSTER,
  TAG_HR_DASHBOARD,
  TAG_MANAGER_DASHBOARD,
  TAG_RECRUITMENT,
  TAG_APPRAISALS,
];

// Scratch state, torn down in the finally block.
let scratchHolidayId: string | null = null;
let scratchLeaveId: string | null = null;
let subjectId: string | null = null;
let originalManagerId: string | null | undefined;
let originalDepartment: string | null = null;

try {
  // A previous run's entries live on disk under .next/cache. Drop every tag
  // first so "the first read is a miss" is a fact rather than a hope.
  await forceCold(ALL_TAGS);
  await queries();

  // ══════════════════════════════════════════════════════════════════════════
  heading("1 · GREEN TIER — department list (§2/§4, 1 hr TTL, tag 'departments')");

  const d1 = await request(() => getDepartments());
  const q1 = await queries();
  check("cold read hits the database", q1 >= 1, `${q1} quer${q1 === 1 ? "y" : "ies"}: ${JSON.stringify(d1)}`);

  const d2 = await request(() => getDepartments());
  const q2 = await queries();
  check("second read inside the TTL is served from cache", q2 === 0, `${q2} queries`);
  eq("...and returns the identical value", d2, d1);

  // Now change the underlying data. `department` is a column on Employee in
  // this schema (there is no Department table), so changing an employee's
  // department IS a change to the department list.
  const subject = await db.employee.findFirst({
    where: { active: true },
    select: { id: true, department: true, managerId: true, employeeCode: true },
    orderBy: { employeeCode: "asc" },
  });
  if (!subject) throw new Error("No active employee in the database — cannot run the write tests.");
  subjectId = subject.id;
  originalDepartment = subject.department;
  originalManagerId = subject.managerId;
  console.log(`\n  subject: ${subject.employeeCode}, department "${subject.department}"\n`);

  const probeDept = "ZZ-CACHE-SELFCHECK";
  await db.employee.update({ where: { id: subject.id }, data: { department: probeDept } });
  console.log(`  [write] ${subject.employeeCode}.department -> "${probeDept}"`);

  const d3 = await request(() => getDepartments());
  await queries();
  check(
    "before invalidation the stale list is still served (proving it was cached)",
    !d3.includes(probeDept),
    JSON.stringify(d3),
  );

  // The invalidation function the employee routes call after their write.
  await request(async () => onEmployeeRosterChanged({ employeeId: subject.id }));
  console.log("  [invalidate] onEmployeeRosterChanged()");

  const d4 = await request(() => getDepartments());
  const q4 = await queries();
  check(
    "after invalidation the NEXT read reflects the change immediately",
    d4.includes(probeDept) && q4 >= 1,
    `${q4} queries: ${JSON.stringify(d4)}`,
  );

  await db.employee.update({ where: { id: subject.id }, data: { department: originalDepartment } });
  await request(async () => onEmployeeRosterChanged({ employeeId: subject.id }));
  console.log(`  [restore] ${subject.employeeCode}.department -> "${originalDepartment}"`);
  const d5 = await request(() => getDepartments());
  await queries();
  eq("restored department list matches the original", d5, d1);

  // ══════════════════════════════════════════════════════════════════════════
  heading("2 · GREEN TIER — holiday calendar (§2/§4, 6 hr TTL, tag 'holidays')");

  const h1 = await request(() => getHolidayCalendar());
  await queries();
  const h2 = await request(() => getHolidayCalendar());
  check("second read is served from cache", (await queries()) === 0, `${h2.length} holidays`);

  const created = await db.holiday.create({
    data: { name: "ZZ-CACHE-SELFCHECK", date: new Date(2099, 0, 1), createdBy: "selfcheck" },
  });
  scratchHolidayId = created.id;
  console.log(`  [write] created holiday ${created.id}`);

  const h3 = await request(() => getHolidayCalendar());
  await queries();
  check("stale calendar still served before invalidation", h3.length === h1.length);

  await request(async () => onHolidayCalendarChanged());
  console.log("  [invalidate] onHolidayCalendarChanged()");
  const h4 = await request(() => getHolidayCalendar());
  await queries();
  check(
    "next read shows the new holiday immediately",
    h4.some((h) => h.id === created.id),
    `${h4.length} holidays`,
  );
  check(
    "cached dates survive the Data Cache round-trip as YYYY-MM-DD strings",
    h4.every((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date)),
  );

  // ══════════════════════════════════════════════════════════════════════════
  heading("3 · ORANGE TIER — HR dashboard totals (§2/§4, 30 s TTL)");

  const t1 = await request(() => getHrDashboardTotals(period, todayYmd));
  const tq1 = await queries();
  check("cold read runs the aggregate batch", tq1 >= 1, `${tq1} queries, headcount ${t1.activeCount}`);

  const t2 = await request(() => getHrDashboardTotals(period, todayYmd));
  check("second read inside the 30 s window is a cache hit", (await queries()) === 0);
  eq("...same headcount", t2.activeCount, t1.activeCount);

  check(
    "only counts are cached — no money value appears in the totals object",
    Object.keys(t1.payroll).every((k) => ["draft", "submitted", "finalized"].includes(k)) &&
      Object.values(t1.payroll).every((v) => Number.isInteger(v)),
    JSON.stringify(t1.payroll),
  );

  await request(async () => onEmployeeRosterChanged());
  const t3 = await request(() => getHrDashboardTotals(period, todayYmd));
  check("§5 'HR dashboard source data changed' drops the aggregate", (await queries()) >= 1, `headcount ${t3.activeCount}`);

  // ══════════════════════════════════════════════════════════════════════════
  heading("4 · ORANGE TIER — pending approvals: TTL expiry AND §5 invalidation");

  // The count is scoped by managerId. This database has one active employee
  // and no manager, so the employee is briefly pointed at themselves: the
  // cached reader's where-clause is `employee.managerId = <id>`, and what is
  // under test is the caching and invalidation of that count, not the
  // org chart. Restored in the finally block.
  await db.employee.update({ where: { id: subjectId }, data: { managerId: subjectId } });
  console.log(`  [write] temporary managerId on ${subject.employeeCode}`);

  const p0 = await request(() => getPendingLeaveCount(subjectId!));
  await queries();
  console.log(`  baseline pending count: ${p0}`);

  const leave = await db.leaveRequest.create({
    data: {
      employeeId: subjectId!,
      startDate: new Date(2099, 0, 1),
      endDate: new Date(2099, 0, 2),
      reason: "ZZ-CACHE-SELFCHECK",
      status: "PENDING",
    },
  });
  scratchLeaveId = leave.id;
  console.log(`  [write] created PENDING leave request ${leave.id}`);

  const p1 = await request(() => getPendingLeaveCount(subjectId!));
  await queries();
  eq("no invalidation yet — the cached count is still the old one", p1, p0);

  console.log(`  ... waiting ${DASHBOARD_TTL + 2}s for the ORANGE TTL to lapse`);
  await new Promise((r) => setTimeout(r, (DASHBOARD_TTL + 2) * 1000));

  await request(() => getPendingLeaveCount(subjectId!)); // stale-while-revalidate refill
  await queries();
  const p2 = await request(() => getPendingLeaveCount(subjectId!));
  await queries();
  eq(`ORANGE value updates on its own within the ${DASHBOARD_TTL}s window`, p2, p0 + 1);

  // ── §5: "Employee leave approved → invalidate ... manager approvals and
  //        affected dashboard" — the EXACT atomic update the route performs.
  const upd = await db.leaveRequest.updateMany({
    where: { id: leave.id, status: "PENDING", employee: { managerId: subjectId! } },
    data: { status: "APPROVED", approvedBy: "selfcheck" },
  });
  console.log(`  [write] approved via the route's atomic where-clause (${upd.count} row)`);
  eq("the approval actually transitioned exactly one row", upd.count, 1);

  await request(async () => onLeaveDecided(subjectId!));
  console.log("  [invalidate] onLeaveDecided()");

  const p3 = await request(() => getPendingLeaveCount(subjectId!));
  const pq3 = await queries();
  eq("next read reflects the approval IMMEDIATELY, not after a TTL", p3, p0);
  check("...and it came from the database, not the cache", pq3 >= 1, `${pq3} queries`);

  // ══════════════════════════════════════════════════════════════════════════
  heading("5 · §5 attendance mapping — punch invalidates the attendance aggregates");

  await request(() => getHrDashboardTotals(period, todayYmd));
  await queries();
  await request(() => getHrDashboardTotals(period, todayYmd));
  check("HR totals warm before the punch", (await queries()) === 0);

  await request(async () => onAttendanceRecorded());
  console.log("  [invalidate] onAttendanceRecorded()  (as app/api/attendance/punch calls it)");
  await request(() => getHrDashboardTotals(period, todayYmd));
  check("'Present Today' aggregate is re-read after a punch", (await queries()) >= 1);

  // ══════════════════════════════════════════════════════════════════════════
  heading("6 · RED TIER — no caching anywhere in the call path (§3)");

  const RED_ENTRY_POINTS: [string, string][] = [
    ["Payroll preview (draft run)", "app/api/hr/payroll/run/route.ts"],
    ["Payroll preview display", "app/hr/payroll/page.tsx"],
    ["Payroll finalization", "app/api/admin/payroll/finalize/route.ts"],
    ["Payroll submit", "app/api/hr/payroll/submit/route.ts"],
    ["Payroll row edit (payslip values)", "app/api/hr/payroll/row/route.ts"],
    ["Payroll adjustment", "app/api/hr/payroll/adjustment/route.ts"],
    ["Finalized payroll records", "app/admin/payroll/page.tsx"],
    ["Payslip financial values", "app/api/payslip/[id]/route.ts"],
    ["Employee net salary / payslips", "app/employee/payslips/page.tsx"],
    ["Tax / deduction values (Form 16)", "app/api/form16/route.ts"],
    ["Employee salary structure (write)", "app/api/hr/salary-structure/route.ts"],
    ["Employee salary structure (read)", "app/hr/salary-structure/page.tsx"],
    ["Salary advance (payroll input)", "app/api/hr/salary-advance/route.ts"],
    ["Audit logs", "app/admin/audit-log/page.tsx"],
    ["Permissions / role scope", "lib/auth.ts"],
    ["Authorization scope resolution", "lib/data/scope.ts"],
    ["Secrets / tokens", "lib/idle/token.ts"],
    ["Agent token issuance", "app/api/hr/agent-token/route.ts"],
  ];

  for (const [label, entry] of RED_ENTRY_POINTS) {
    if (!existsSync(nodePath.join(ROOT, entry))) {
      check(`${label} — file exists`, false, entry);
      continue;
    }
    const closure = importClosure(entry);
    const offenders: string[] = [];
    for (const file of closure) {
      const markers = cacheMarkersIn(file);
      if (markers.length) {
        offenders.push(`${nodePath.relative(ROOT, file).split("\\").join("/")}: ${markers.join(", ")}`);
      }
    }
    const memoised = closure
      .filter((f) => REACT_CACHE.test(readFileSync(f, "utf8")))
      .map((f) => nodePath.relative(ROOT, f).split("\\").join("/"));
    check(
      `${label} — ${closure.length} files on its call path, zero shared caching`,
      offenders.length === 0,
      offenders.length
        ? offenders.join("\n        ")
        : memoised.length
          ? `React cache() per-render memo only (§1-permitted): ${memoised.join(", ")}`
          : "",
    );
  }

  // The `cache` React memo is a per-render dedupe, not a shared cache (§1), and
  // lib/auth.ts uses it deliberately. Assert it is the ONLY such use on a RED
  // path, so its presence is a known exception rather than an unnoticed one.
  const authSrc = readFileSync(nodePath.join(ROOT, "lib/auth.ts"), "utf8");
  check(
    "lib/auth.ts uses React cache() — per-request memo only, never a shared cache",
    /import\s*\{\s*cache\s*\}\s*from\s*["']react["']/.test(authSrc) &&
      !/unstable_cache|next\/cache|@\/lib\/cache\//.test(authSrc),
  );

  // ── Runtime: the same double-call pattern that produced ZERO queries for a
  // cached reader produces a query EVERY time on the payroll preview's own
  // authoritative input read, through the same shared `db` client.
  const previewRead = () =>
    db.employee.findMany({
      where: { active: true },
      include: { salaryStructure: true },
    });

  await queries();
  await previewRead();
  const r1 = await queries();
  await previewRead();
  const r2 = await queries();
  await previewRead();
  const r3 = await queries();
  check(
    "payroll preview's authoritative input read executes on EVERY call",
    r1 >= 1 && r2 >= 1 && r3 >= 1,
    `queries per call: ${r1}, ${r2}, ${r3} — a cached reader returned 0 on its second call above`,
  );

  const payrollRows = await db.payroll.findMany({ take: 1 });
  const payrollRows2 = await db.payroll.findMany({ take: 1 });
  check(
    "finalized payroll records are re-read from the database every time",
    (await queries()) >= 2,
    `${payrollRows.length + payrollRows2.length} rows read across 2 calls`,
  );

  // ── REPORTS: no format is cached, for any report, RED tier or otherwise.
  //
  // This replaces the runtime guard that used to live in lib/cache/reports.ts
  // (isReportPreviewCacheable / getCachedReportPreview, which threw for the
  // three RED reports). That module is gone: with the preview cache removed
  // there is nothing left for it to refuse, and a function with no call site
  // cannot stop a future regression — the developer who reintroduces caching
  // is precisely the one who would not think to call it.
  //
  // What replaces it is a check that actually runs. The route is asserted
  // cache-free, and each RED report module's whole import closure is scanned
  // for every caching mechanism in §1's list — so reintroducing one anywhere
  // on those paths fails this suite.
  const reportsRouteSrc = readFileSync(
    nodePath.join(ROOT, "app/api/reports/[report]/route.ts"),
    "utf8",
  );
  check(
    "the reports route calls runReport exactly once",
    (reportsRouteSrc.match(/await runReport\(/g) ?? []).length === 1,
    `${(reportsRouteSrc.match(/await runReport\(/g) ?? []).length} call(s)`,
  );
  check(
    "the reports route imports nothing from lib/cache/",
    !/@\/lib\/cache\//.test(reportsRouteSrc),
  );
  check(
    "every report format renders from the same `run` binding",
    /format"\) === "json"[\s\S]{0,400}result: run\.result/.test(reportsRouteSrc) &&
      /format"\) === "csv"[\s\S]{0,400}run\.csv\(\)/.test(reportsRouteSrc) &&
      /await run\.pdf\(\)/.test(reportsRouteSrc),
  );
  check(
    "lib/cache/reports.ts no longer exists — nothing to cache a report with",
    !existsSync(nodePath.join(ROOT, "lib/cache/reports.ts")),
  );

  for (const [label, entry] of [
    ["payroll-cost (payroll financial values)", "lib/reports/payroll-cost.ts"],
    ["board-summary (embeds payroll cost)", "lib/reports/board-summary.ts"],
    ["my-data (personal manifest)", "lib/reports/my-data.ts"],
    ["the reports route itself", "app/api/reports/[report]/route.ts"],
  ] as [string, string][]) {
    const closure = importClosure(entry);
    const offenders: string[] = [];
    for (const file of closure) {
      const markers = cacheMarkersIn(file);
      if (markers.length) {
        offenders.push(
          `${nodePath.relative(ROOT, file).split("\\").join("/")}: ${markers.join(", ")}`,
        );
      }
    }
    check(
      `RED report ${label} — ${closure.length} files on call path, zero caching`,
      offenders.length === 0,
      offenders.join("\n        "),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  heading("7 · SECURITY (§8) — what may and may not enter a cache");

  const { readdirSync } = await import("node:fs");
  const cacheFiles = readdirSync(nodePath.join(ROOT, "lib/cache")).filter((f) => f.endsWith(".ts"));
  const FORBIDDEN_IN_CACHE =
    /\b(password|secret|apiKey|token|clerkId|sessionClaims|net|gross|tds|pfEmployee|esi|professionalTax|basic|hra|specialAllowance|deductions)\s*:\s*true/;
  for (const f of cacheFiles) {
    const src = readFileSync(nodePath.join(ROOT, "lib/cache", f), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    check(
      `lib/cache/${f} selects no secret, session or money field`,
      !FORBIDDEN_IN_CACHE.test(code),
      (code.match(FORBIDDEN_IN_CACHE) ?? []).join(""),
    );
  }

  check(
    "no cached reader is imported by lib/auth.ts or middleware.ts (no cached authority)",
    !/@\/lib\/cache\//.test(readFileSync(nodePath.join(ROOT, "lib/auth.ts"), "utf8")) &&
      !/@\/lib\/cache\//.test(readFileSync(nodePath.join(ROOT, "middleware.ts"), "utf8")),
  );

  // §8: only genuinely public routes may be cached at a shared/CDN layer. Every
  // authenticated page and route in this app is force-dynamic, which keeps it
  // out of every shared layer; /careers is the one public surface.
  const authedSamples = [
    "app/hr/page.tsx",
    "app/hr/payroll/page.tsx",
    "app/manager/page.tsx",
    "app/employee/profile/page.tsx",
    "app/api/payslip/[id]/route.ts",
    "app/api/reports/[report]/route.ts",
  ];
  for (const f of authedSamples) {
    const src = readFileSync(nodePath.join(ROOT, f), "utf8");
    check(
      `${f} is force-dynamic (never CDN-cacheable)`,
      /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/.test(src),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  heading("8 · §11 — Redis was not added");

  const pkg = JSON.parse(readFileSync(nodePath.join(ROOT, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  check(
    "no redis / ioredis / upstash dependency",
    !deps.some((d) => /redis|upstash/i.test(d)),
    deps.filter((d) => /redis|upstash/i.test(d)).join(", "),
  );
  for (const f of cacheFiles) {
    const src = readFileSync(nodePath.join(ROOT, "lib/cache", f), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    check(`lib/cache/${f} contains no Redis scaffolding`, !/redis|upstash/i.test(code));
  }
} finally {
  heading("TEARDOWN");
  try {
    if (scratchLeaveId) {
      await db.leaveRequest.delete({ where: { id: scratchLeaveId } });
      console.log(`  removed scratch leave request ${scratchLeaveId}`);
    }
    if (scratchHolidayId) {
      await db.holiday.delete({ where: { id: scratchHolidayId } });
      console.log(`  removed scratch holiday ${scratchHolidayId}`);
    }
    if (subjectId) {
      await db.employee.update({
        where: { id: subjectId },
        data: { managerId: originalManagerId ?? null, department: originalDepartment ?? undefined },
      });
      console.log(
        `  restored employee ${subjectId}: department "${originalDepartment}", managerId ${originalManagerId ?? "null"}`,
      );
    }
    await forceCold(ALL_TAGS);
    console.log("  dropped every cache tag");
  } catch (err) {
    failures++;
    console.log(`  TEARDOWN FAILED: ${String(err)}`);
  }
  await db.$disconnect();
}

console.log(
  `\n${"═".repeat(74)}\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n${"═".repeat(74)}`,
);
process.exit(failures === 0 ? 0 : 1);
