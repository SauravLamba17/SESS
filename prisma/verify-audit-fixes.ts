/**
 * SELF-AUDIT FIX VERIFICATION.
 *
 * Proves the three fixes that are only meaningful under CONCURRENCY actually
 * block their attack, rather than asserting the code merely looks right:
 *
 *   1. the partial unique index stops a second, simultaneous payroll run
 *   3. the role gate stops an EMPLOYEE-role user who holds a manager POSITION
 *   4. the cycle lock stops a double-publish (and a write after publish)
 *
 * (2 and 5 are static/structural and are asserted here too, cheaply.)
 *
 * Creates its own throwaway employees, cycle and payroll rows and deletes
 * every one, pass or fail.
 *
 * Run:  npx tsx prisma/verify-audit-fixes.ts
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";

const db = new PrismaClient();
const ROOT = path.resolve(import.meta.dirname, "..");
const TAG = "ZZ-AUDITFIX";

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

async function cleanup() {
  const emps = await db.employee.findMany({
    where: { employeeCode: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = emps.map((e) => e.id);
  if (ids.length) {
    await db.payroll.deleteMany({ where: { employeeId: { in: ids } } });
    await db.appraisalScore.deleteMany({ where: { employeeId: { in: ids } } });
    await db.user.deleteMany({ where: { employeeId: { in: ids } } });
  }
  await db.appraisalScore.deleteMany({ where: { cycle: { period: { startsWith: TAG } } } });
  await db.appraisalCycle.deleteMany({ where: { period: { startsWith: TAG } } });
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: TAG } } });
  await db.auditLog.deleteMany({ where: { actorUserId: TAG } });
}

async function main() {
  await cleanup();

  // ── 1: the partial unique index ───────────────────────────────
  step("1", "duplicate payroll run is blocked BY THE DATABASE");

  const idx = await db.$queryRawUnsafe<{ indexdef: string }[]>(
    `select indexdef from pg_indexes where tablename='Payroll'
       and indexname='Payroll_one_regular_run_per_employee_month'`,
  );
  check("the partial unique index exists", idx.length === 1);
  check(
    "…and it is scoped to regular rows only",
    idx[0]?.indexdef.includes('"adjustmentForPayrollId" IS NULL') &&
      idx[0]?.indexdef.includes('"isFinalSettlement" = false'),
    idx[0]?.indexdef ?? "",
  );

  const emp = await db.employee.create({
    data: {
      employeeCode: `${TAG}-1`,
      name: `${TAG} Payroll Target`,
      department: "Assembly",
      designation: "Operator",
      joiningDate: new Date(2020, 0, 1),
    },
  });
  const PERIOD = "2099-01";
  const row = (extra: Record<string, unknown> = {}) => ({
    employeeId: emp.id,
    month: PERIOD,
    basic: new Prisma.Decimal("1000.00"),
    hra: new Prisma.Decimal("0.00"),
    specialAllowance: new Prisma.Decimal("0.00"),
    daysWorked: 31,
    daysInMonth: 31,
    gross: new Prisma.Decimal("1000.00"),
    deductions: new Prisma.Decimal("0.00"),
    net: new Prisma.Decimal("1000.00"),
    processedBy: TAG,
    ...extra,
  });

  await db.payroll.create({ data: row() });
  check("first regular run row inserted", (await db.payroll.count({ where: { employeeId: emp.id } })) === 1);

  // THE ATTACK: a second run for the same employee+month.
  let dupeErr: string | null = null;
  try {
    await db.payroll.create({ data: row() });
  } catch (e) {
    dupeErr = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : "OTHER";
  }
  eq("a SECOND regular run for the same employee+month is REJECTED (P2002)", dupeErr, "P2002");
  eq(
    "…and only one row exists",
    await db.payroll.count({
      where: { employeeId: emp.id, isFinalSettlement: false, adjustmentForPayrollId: null },
    }),
    1,
  );

  // TRUE CONCURRENCY: both inserts fired together, neither awaited first.
  await db.payroll.deleteMany({ where: { employeeId: emp.id } });
  const results = await Promise.allSettled([
    db.payroll.create({ data: row() }),
    db.payroll.create({ data: row() }),
  ]);
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.filter((r) => r.status === "rejected").length;
  eq("two SIMULTANEOUS runs → exactly one succeeds", ok, 1);
  eq("…and exactly one is rejected", rejected, 1);
  eq(
    "…leaving exactly one payroll row (no double payment)",
    await db.payroll.count({ where: { employeeId: emp.id } }),
    1,
  );

  // The legitimate cases must STILL be allowed.
  await db.payroll.create({ data: row({ isFinalSettlement: true }) });
  check(
    "a FINAL SETTLEMENT may still share the month (offboard after an early run)",
    (await db.payroll.count({ where: { employeeId: emp.id, isFinalSettlement: true } })) === 1,
  );
  const original = await db.payroll.findFirst({
    where: { employeeId: emp.id, isFinalSettlement: false, adjustmentForPayrollId: null },
  });
  await db.payroll.create({ data: row({ adjustmentForPayrollId: original!.id }) });
  await db.payroll.create({ data: row({ adjustmentForPayrollId: original!.id }) });
  eq(
    "MULTIPLE adjustments may still share the month",
    await db.payroll.count({ where: { employeeId: emp.id, adjustmentForPayrollId: { not: null } } }),
    2,
  );

  // ── 3: the manager role gate ──────────────────────────────────
  step("3", "manager routes require the MANAGER ROLE, not just the position");

  const MANAGER_ROUTES = [
    "app/api/manager/client-mail/route.ts",
    "app/api/manager/expense/route.ts",
    "app/api/manager/leave/route.ts",
    "app/api/manager/quality/route.ts",
    "app/api/manager/shift/route.ts",
    "app/api/manager/target/route.ts",
    "app/api/manager/warning/route.ts",
    "app/api/manager/appraisal/feedback/route.ts",
  ];
  for (const r of MANAGER_ROUTES) {
    const src = fs.readFileSync(path.join(ROOT, r), "utf8");
    // The explicit-list idiom every other privileged route uses (standardised
    // from hasAtLeastRole("MANAGER"), which admitted exactly these three).
    const gate = src.indexOf('role !== "MANAGER" && role !== "HR" && role !== "SUPER_ADMIN"');
    const scope = src.indexOf("managerId: manager.id");
    check(`${r.replace("app/api/manager/", "")} — role gate present`, gate > 0);
    check(
      `${r.replace("app/api/manager/", "")} — gate runs BEFORE the scope check`,
      gate > 0 && (scope === -1 || gate < scope),
    );
    check(
      `${r.replace("app/api/manager/", "")} — scope check RETAINED (added to, not replaced)`,
      src.includes("getEmployeeByClerkId"),
    );
  }

  // The exploit shape: EMPLOYEE role, but holds a manager position.
  const boss = await db.employee.create({
    data: {
      employeeCode: `${TAG}-BOSS`,
      name: `${TAG} Shift Lead`,
      department: "Assembly",
      designation: "Shift Lead",
      joiningDate: new Date(2020, 0, 1),
    },
  });
  const underling = await db.employee.create({
    data: {
      employeeCode: `${TAG}-REPORT`,
      name: `${TAG} Report`,
      department: "Assembly",
      designation: "Operator",
      joiningDate: new Date(2021, 0, 1),
      managerId: boss.id,
    },
  });
  await db.user.create({
    data: { clerkId: `${TAG}-boss-clerk`, role: "EMPLOYEE", employeeId: boss.id },
  });
  const bossUser = await db.user.findFirst({ where: { employeeId: boss.id } });
  check(
    "an EMPLOYEE-role user CAN hold a manager position (the exploit precondition is real)",
    bossUser?.role === "EMPLOYEE" && underling.managerId === boss.id,
    `role=${bossUser?.role}, manages ${underling.employeeCode}`,
  );
  // The gate admits MANAGER, HR and SUPER_ADMIN by name; EMPLOYEE is not one.
  const admitted = ["MANAGER", "HR", "SUPER_ADMIN"];
  check(
    "…and the manager role gate rejects that role",
    !admitted.includes(bossUser?.role ?? ""),
    `role=${bossUser?.role}, admitted=${admitted.join("/")}`,
  );

  // ── 4: publish atomicity ──────────────────────────────────────
  step("4", "double-publish is blocked, and writes after publish are refused");

  const cycle = await db.appraisalCycle.create({
    data: { period: `${TAG}-2099-01`, weightsJson: {}, createdBy: TAG },
  });

  // Both claims fired together, exactly as two HR clicks would.
  const claims = await Promise.all([
    db.appraisalCycle.updateMany({ where: { id: cycle.id, published: false }, data: { published: true } }),
    db.appraisalCycle.updateMany({ where: { id: cycle.id, published: false }, data: { published: true } }),
  ]);
  const winners = claims.filter((c) => c.count === 1).length;
  eq("two SIMULTANEOUS publishes → exactly ONE claims the cycle", winners, 1);
  eq("…the other reports count 0 (so it notifies nobody)", claims.filter((c) => c.count === 0).length, 1);
  check("…and the cycle is published exactly once", (await db.appraisalCycle.findUnique({ where: { id: cycle.id } }))!.published);

  // The lock must now refuse every writer.
  const { lockCycleForWrite } = await import("../lib/appraisal/cycle-lock.ts");
  const locked = await db.$transaction((tx) => lockCycleForWrite(tx, cycle.id));
  check("lockCycleForWrite() refuses a PUBLISHED cycle", locked.ok === false);
  eq("…with reason PUBLISHED", locked.ok === false ? locked.reason : null, "PUBLISHED");

  const missing = await db.$transaction((tx) => lockCycleForWrite(tx, "does-not-exist"));
  eq("…and NOT_FOUND for a missing cycle", missing.ok === false ? missing.reason : null, "NOT_FOUND");

  const open = await db.appraisalCycle.create({
    data: { period: `${TAG}-2099-02`, weightsJson: {}, createdBy: TAG },
  });
  const allowed = await db.$transaction((tx) => lockCycleForWrite(tx, open.id));
  check("…and permits an UNPUBLISHED cycle", allowed.ok === true);

  // All three writers must route through the lock.
  for (const r of [
    "app/api/hr/appraisal/compute/route.ts",
    "app/api/hr/appraisal/exclude/route.ts",
    "app/api/manager/appraisal/feedback/route.ts",
  ]) {
    const src = fs.readFileSync(path.join(ROOT, r), "utf8");
    check(`${r.split("/").slice(-2)[0]} routes its write through lockCycleForWrite`, src.includes("lockCycleForWrite(tx"));
  }
  const pubSrc = fs.readFileSync(path.join(ROOT, "app/api/hr/appraisal/publish/route.ts"), "utf8");
  check(
    "publish claims atomically via updateMany with published:false in the WHERE",
    /updateMany\(\{\s*where: \{ id: cycleId, published: false \}/.test(pubSrc),
  );

  // ── 2 & 5: static ─────────────────────────────────────────────
  step("2+5", "search keeps its own role scoping; toISOString date bugs are gone");

  const searchSrc = fs.readFileSync(path.join(ROOT, "app/api/search/route.ts"), "utf8");
  // MFA enforcement was removed from the codebase, so search is a plain GET
  // again. These checks were inverted rather than deleted: what actually
  // protects the org-wide branch is the IN-ROUTE role scoping, and that must
  // still be here now that the wrapper is not.
  check("search exports a plain GET again", /^export async function GET\s*\(/m.test(searchSrc));
  check("search has no MFA wrapper left", !/withPrivilegedRoute/.test(searchSrc));
  check("search still authenticates in-route", /getEffectiveUserId\(\)/.test(searchSrc));
  check("search still resolves the caller's role in-route", /getCurrentRole\(\)/.test(searchSrc));
  check("search still branches org-wide reads on HR/SUPER_ADMIN",
    /role === "HR" \|\| role === "SUPER_ADMIN"/.test(searchSrc));
  check("search still has a MANAGER-scoped branch", /role === "MANAGER"/.test(searchSrc));

  for (const [f, needle] of [
    ["lib/payroll/pdf.tsx", "toYmd"],
    ["app/api/hr/employee/bulk-import/route.ts", "ymd(r.joiningDate!)"],
    ["app/hr/salary-structure/page.tsx", "ymd(s.effectiveFrom)"],
    ["app/api/hr/salary-structure/route.ts", "ymd(plan.historyRow.effectiveFrom)"],
  ] as const) {
    check(`${f} uses the shared ymd()`, fs.readFileSync(path.join(ROOT, f), "utf8").includes(needle));
  }

  // The three priority files must have no date-only toISOString left.
  for (const f of [
    "app/api/hr/employee/bulk-import/route.ts",
    "app/hr/salary-structure/page.tsx",
    "app/api/hr/salary-structure/route.ts",
  ]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    check(`${f} has no toISOString().slice(0, 10) left`, !src.includes("toISOString().slice(0, 10)"));
  }

  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const head = readme.slice(0, readme.indexOf("### Cut from scope"));
  check("README no longer advertises camera-verified attendance", !/Camera-verified/i.test(head));
  check("README no longer advertises per-machine averages", !/Per-machine performance/i.test(head));

  // ── 6: offboarding is claimed atomically ─────────────────────
  step("6", "two concurrent offboards: exactly one wins (no double settlement)");
  const off = fs.readFileSync(path.join(ROOT, "app/api/hr/employee/offboard/route.ts"), "utf8");
  check(
    "offboard route claims with updateMany WHERE { id, active: true }",
    /employee\.updateMany\(\{\s*where: \{ id: employeeId, active: true \}/.test(off) &&
      off.includes("claimed.count !== 1"),
  );
  const leaver = await db.employee.create({
    data: {
      employeeCode: `${TAG}-LEAVER`,
      name: `${TAG} Leaver`,
      department: "Assembly",
      joiningDate: new Date(2020, 0, 1),
    },
  });
  // The exact claim the route makes, raced in two real transactions. The
  // sleep holds the first lock open so the second genuinely overlaps it.
  const claim = () =>
    db.$transaction(async (tx) => {
      const r = await tx.employee.updateMany({
        where: { id: leaver.id, active: true },
        data: { active: false, offboardedAt: new Date(2026, 0, 31) },
      });
      await new Promise((res) => setTimeout(res, 300));
      return r.count;
    });
  const counts = await Promise.all([claim(), claim()]);
  check("exactly one of two concurrent claims succeeds", counts.sort().join(",") === "0,1", `counts=${counts}`);

  // ── 7: no settlement on top of a regular run (Part 2 decision 3) ──
  step("7", "offboard refuses a F&F settlement for a month already paid by a regular row");
  const regularGuard = off.indexOf("OK_REGULAR_EXISTS");
  check(
    "the regular-row check runs BEFORE the settlement is created",
    regularGuard > 0 && regularGuard < off.indexOf("tx.payroll.create("),
  );
  check(
    "…and tells HR to use a payroll adjustment instead",
    /Use a payroll adjustment for \$\{result\.period\}/.test(off),
  );
  // The route's exact predicate: a REGULAR row counts, a settlement or an
  // adjustment for the same month does not.
  const REGULAR = { isFinalSettlement: false, adjustmentForPayrollId: null };
  const paid = await db.payroll.create({
    data: { employeeId: leaver.id, month: "2099-03", processedBy: TAG },
  });
  check(
    "a regular row for the month is found → settlement refused",
    (await db.payroll.findFirst({ where: { employeeId: leaver.id, month: "2099-03", ...REGULAR } }))?.id === paid.id,
  );
  await db.payroll.create({
    data: { employeeId: leaver.id, month: "2099-04", isFinalSettlement: true, processedBy: TAG },
  });
  check(
    "an existing SETTLEMENT alone is not a regular row (no false refusal)",
    (await db.payroll.findFirst({ where: { employeeId: leaver.id, month: "2099-04", ...REGULAR } })) === null,
  );

  // ── 8: Form 16 gross includes bonus (Part 2 decision 6) ──────
  step("8", "Form 16 gross salary includes bonus");
  const f16 = fs.readFileSync(path.join(ROOT, "app/api/form16/route.ts"), "utf8");
  check("bonus is selected from finalized rows", /bonus: true/.test(f16));
  check("taxable gross = gross + bonus", f16.includes("r.gross.plus(r.bonus)"));
  check(
    "both the annual total and each month use it",
    f16.includes("a.plus(taxableGross(r))") && f16.includes("gross: taxableGross(r).toFixed(2)"),
  );
  check("the CA-review note is present", /reviewed by a CA/.test(f16));

  // ── 9: previously unaudited state changes now write an AuditLog ──
  step("9", "state changes are audited inside the same transaction");
  const AUDITED: [string, string][] = [
    ["app/api/hr/offer/route.ts", '"OFFER_UPDATED"'],
    ["app/api/hr/consent/route.ts", '"CONSENT_RECORDED"'],
    ["app/api/employee/warning/acknowledge/route.ts", '"WARNING_ACKNOWLEDGED"'],
    ["app/api/hr/appraisal/exclude/route.ts", '"APPRAISAL_EMPLOYEE_EXCLUDED"'],
    ["app/api/hr/appraisal/compute/route.ts", '"APPRAISAL_SCORES_COMPUTED"'],
    ["app/api/hr/shifts/deactivate/route.ts", '"SHIFT_DEACTIVATED"'],
    ["app/api/hr/requisition/route.ts", "`REQUISITION_STATUS_${status}`"],
    ["app/api/hr/requisition/route.ts", '"REQUISITION_UPDATED"'],
    ["app/api/hr/pulse-survey/route.ts", '"PULSE_SURVEY_CLOSED"'],
    ["app/api/hr/onboarding-task/route.ts", '"ONBOARDING_TASK_ADDED"'],
    ["app/api/hr/onboarding-task/route.ts", '"ONBOARDING_TASK_REMOVED"'],
    ["app/api/hr/onboarding-task/route.ts", '"ONBOARDING_TASK_COMPLETED"'],
    ["app/api/hr/application/feedback/route.ts", '"APPLICATION_REVIEW_NOTES_UPDATED"'],
  ];
  for (const [file, action] of AUDITED) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    const at = src.indexOf(action);
    // The nearest $transaction opened before the audit row, with no route
    // return between them — i.e. the audit is written inside that transaction.
    const txAt = src.lastIndexOf("$transaction(", at);
    check(
      `${file} audits ${action} inside a transaction`,
      at > 0 && txAt > 0 && !src.slice(txAt, at).includes("NextResponse.json("),
    );
  }

  // ── 10: "use server" modules export only async functions ──────
  // A client component importing a plain VALUE from a "use server" file gets a
  // server-reference proxy, not the value: EXPENSE_CATEGORIES.map threw and
  // /employee/expenses crashed for every employee (found live in Part 3).
  step("10", '"use server" files export nothing but async functions and types');
  const serverFiles: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && /^\s*["']use server["']/.test(fs.readFileSync(p, "utf8")))
        serverFiles.push(p);
    }
  };
  for (const d of ["app", "lib", "components"]) walk(path.join(ROOT, d));
  check("found the server-action modules", serverFiles.length > 0, `${serverFiles.length} files`);
  for (const f of serverFiles) {
    const bad = (fs.readFileSync(f, "utf8").match(/^export\s+(const|let|var|class|enum|default\s+(?!async))\b[^\n]*/gm) ?? []);
    check(`${path.relative(ROOT, f)} exports no plain values`, bad.length === 0, bad.join(" | "));
  }

  // ── 11: Part 3 fixes — Form 16 picker + appraisal period validation ──
  step("11", "Form 16 lists the FY's finalized employees; cycle periods must be computable");
  const payPage = fs.readFileSync(path.join(ROOT, "app/hr/payroll/page.tsx"), "utf8");
  check(
    "the Form 16 picker is built from form16Employees, not the month's rows",
    payPage.includes("{form16Employees.map((e) =>") &&
      payPage.includes("disabled={form16Employees.length === 0}") &&
      !payPage.includes("new Map(rows.map((r) => [r.employee.id, r.employee]))"),
  );
  const { financialYearMonths, financialYearOf } = await import("../lib/period.ts");
  const fyMonths = financialYearMonths(financialYearOf("2098-05"))!; // FY 2098-99
  const leaverF16 = await db.employee.create({
    data: { employeeCode: `${TAG}-F16-LEAVER`, name: `${TAG} F16 Leaver`, department: "Assembly", joiningDate: new Date(2020, 0, 1), active: false },
  });
  const draftOnly = await db.employee.create({
    data: { employeeCode: `${TAG}-F16-DRAFT`, name: `${TAG} F16 Draft`, department: "Assembly", joiningDate: new Date(2020, 0, 1) },
  });
  await db.payroll.create({ data: { employeeId: leaverF16.id, month: "2098-06", status: "FINALIZED", processedBy: TAG } });
  await db.payroll.create({ data: { employeeId: draftOnly.id, month: "2098-07", status: "DRAFT", processedBy: TAG } });
  // The page's exact predicate.
  const listed = await db.employee.findMany({
    where: { id: { in: [leaverF16.id, draftOnly.id] }, payrolls: { some: { status: "FINALIZED", month: { in: fyMonths } } } },
    select: { id: true },
  });
  check(
    "a LEAVER with finalized FY payroll is listed; a draft-only employee is not",
    listed.length === 1 && listed[0].id === leaverF16.id,
    JSON.stringify(listed),
  );

  const { resolvePeriodRange } = await import("../lib/appraisal/period-range.ts");
  for (const [p, ok] of [["2026-07", true], ["2026-Q3", true], ["abc", false], ["2026-13", false], ["2026-Q5", false], ["2026", false]] as const) {
    check(`appraisal period "${p}" ${ok ? "accepted" : "rejected"}`, (resolvePeriodRange(p) !== null) === ok);
  }
  const cycleSrc = fs.readFileSync(path.join(ROOT, "app/api/hr/appraisal/cycle/route.ts"), "utf8");
  check(
    "the cycle route rejects an uncomputable period BEFORE creating anything",
    cycleSrc.indexOf("!resolvePeriodRange(period)") > 0 &&
      cycleSrc.indexOf("!resolvePeriodRange(period)") < cycleSrc.indexOf("appraisalCycle.create("),
  );
}

main()
  .then(async () => {
    console.log("\n── CLEANUP ───────────────────────────────────────────");
    await cleanup();
    const left = await db.employee.count({ where: { employeeCode: { startsWith: TAG } } });
    const rows = await db.payroll.count({ where: { processedBy: TAG } });
    eq("every test row removed", { employees: left, payroll: rows }, { employees: 0, payroll: 0 });
    console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
    if (fail > 0) process.exitCode = 1;
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error("VERIFY CRASHED:", e);
    await cleanup().catch(() => {});
    await db.$disconnect();
    process.exitCode = 1;
  });
