// Step 4 correctness checks — TEST DATABASE ONLY, read-only. Run through lt-run.mjs:
//   node --import ./scripts/loadtest/register.mjs scripts/loadtest/correctness.ts snapshot   (before scenario c/e)
//   node --import ./scripts/loadtest/register.mjs scripts/loadtest/correctness.ts check      (after everything)
// `snapshot` writes lt-snapshot.json (advance balances + a start time) so `check`
// can prove the load test's own writes, not just the seed's.
process.env.TZ = "Asia/Kolkata";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { client } from "./ltdb.ts";
import { instanceStore } from "./db-proxy.ts";
import { runReport } from "@/lib/reports/run";
import { REPORTS } from "@/lib/reports/registry";
import { parseRange } from "@/lib/reports/range";
import { shiftCrossesMidnight } from "@/lib/attendance/validation";

const c = client({ connectionLimit: 1 });
const mode = process.argv[2];
const PERIOD = "2026-10"; // snapshot only; the checks cover every month finalized since

if (mode === "snapshot") {
  const advances = await c.salaryAdvance.findMany({ select: { id: true, employeeId: true, remainingBalance: true, monthlyDeduction: true, status: true } });
  const payroll = await c.payroll.count({ where: { month: PERIOD } });
  writeFileSync("lt-snapshot.json", JSON.stringify({ at: new Date().toISOString(), payroll, advances }, null, 1));
  console.log(JSON.stringify({ snapshot: { at: new Date().toISOString(), payrollRowsForPeriod: payroll, advances: advances.length } }));
  await c.$disconnect();
  process.exit(0);
}

const snap = existsSync("lt-snapshot.json") ? JSON.parse(readFileSync("lt-snapshot.json", "utf8")) : null;
const since = snap ? new Date(snap.at) : new Date(Date.now() - 864e5);
const out: Record<string, unknown> = {};
const fails: string[] = [];
const check = (name: string, ok: boolean, detail: unknown) => { out[name] = { ok, detail }; if (!ok) fails.push(name); };
const n = (rows: { n: bigint | number }[]) => Number(rows[0]?.n ?? 0);

// 1. Duplicates
const dupAtt = await c.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM (SELECT 1 FROM "Attendance" GROUP BY "employeeId", "date" HAVING count(*) > 1) d`;
const dupAttNew = await c.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM (SELECT 1 FROM "Attendance" WHERE "checkIn" >= ${since} GROUP BY "employeeId", "date" HAVING count(*) > 1) d`;
check("no duplicate attendance (employee, shift date)", n(dupAtt) === 0, { duplicatePairsAll: n(dupAtt), duplicatePairsFromLoadTest: n(dupAttNew), dbConstraint: "none — app logic only" });
const dupPay = await c.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM (SELECT 1 FROM "Payroll" WHERE NOT "isFinalSettlement" AND "adjustmentForPayrollId" IS NULL GROUP BY "employeeId", "month" HAVING count(*) > 1) d`;
const idx = await c.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_indexes WHERE indexname = 'Payroll_one_regular_run_per_employee_month'`;
check("no duplicate regular payroll (employee, month)", n(dupPay) === 0 && n(idx) === 1, { duplicatePairs: n(dupPay), partialUniqueIndexPresent: n(idx) === 1 });

// 2. Payroll arithmetic, exact to the paisa (numeric compare in Postgres, no floats)
const arith = await c.$queryRaw<{ total: bigint; badgross: bigint; badded: bigint; badnet: bigint }[]>`
  SELECT count(*) AS total,
    count(*) FILTER (WHERE gross <> basic + hra + "specialAllowance") AS badgross,
    count(*) FILTER (WHERE deductions <> "pfEmployee" + esi + "professionalTax" + tds + "loanDeduction") AS badded,
    count(*) FILTER (WHERE net <> gross - deductions + bonus + reimbursements) AS badnet
  FROM "Payroll"`;
const a = arith[0];
check("payroll arithmetic exact (all rows)", Number(a.badgross) + Number(a.badded) + Number(a.badnet) === 0, { rows: Number(a.total), grossMismatch: Number(a.badgross), deductionsMismatch: Number(a.badded), netMismatch: Number(a.badnet) });
// Every payroll month the load test finalized (since the snapshot).
const periods = (await c.payroll.findMany({ where: { finalizedAt: { gte: since } }, distinct: ["month"], select: { month: true }, orderBy: { month: "asc" } })).map((p) => p.month);
for (const PERIOD of periods) {
  const reimb = await c.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM "Payroll" p
    LEFT JOIN (SELECT "includedInPayrollId" AS pid, sum(amount) AS s FROM "ExpenseClaim" WHERE "includedInPayrollId" IS NOT NULL GROUP BY 1) x ON x.pid = p.id
    WHERE p.month = ${PERIOD} AND p.reimbursements <> coalesce(x.s, 0)`;
  check(`${PERIOD} reimbursements = sum of the claims linked to each row`, n(reimb) === 0, { mismatchedRows: n(reimb) });

  // 3. The load test's payroll run
  const [y, m] = PERIOD.split("-").map(Number);
  const payable = await c.employee.count({ where: { OR: [{ active: true }, { offboardedAt: { gte: new Date(y, m - 1, 1) } }], salaryStructure: { isNot: null }, createdAt: { lt: since } } });
  const rows = await c.payroll.groupBy({ by: ["status"], where: { month: PERIOD }, _count: { _all: true }, _sum: { net: true, gross: true, loanDeduction: true, reimbursements: true } });
  const fin = rows.find((r) => r.status === "FINALIZED");
  check(`${PERIOD} payroll: one FINALIZED row per payable employee`, rows.length === 1 && fin?._count._all === payable, { payableEmployees: payable, byStatus: rows.map((r) => ({ status: r.status, rows: r._count._all })), totalGross: fin?._sum.gross?.toFixed(2), totalNet: fin?._sum.net?.toFixed(2), totalLoan: fin?._sum.loanDeduction?.toFixed(2), totalReimbursements: fin?._sum.reimbursements?.toFixed(2) });
  const sweptLeft = await c.expenseClaim.count({ where: { status: "APPROVED", includedInPayrollId: null, date: { lt: new Date(y, m, 1) }, employee: { payrolls: { some: { month: PERIOD } } } } });
  check(`${PERIOD} every approved claim up to month end was swept into payroll`, sweptLeft === 0, { approvedClaimsLeftBehind: sweptLeft });

  // 5. Audit rows and payslip notifications, per month (punches are not audited, by design)
  const pa = await c.auditLog.groupBy({ by: ["action"], where: { timestamp: { gte: since }, targetEntity: PERIOD, action: { in: ["PAYROLL_RUN_CREATED", "PAYROLL_RUN_SUBMITTED", "PAYROLL_RUN_FINALIZED"] } }, _count: { _all: true } });
  const pac = Object.fromEntries(pa.map((x) => [x.action, x._count._all]));
  check(`${PERIOD} one audit row each for run, submit and finalize`, pac.PAYROLL_RUN_CREATED === 1 && pac.PAYROLL_RUN_SUBMITTED === 1 && pac.PAYROLL_RUN_FINALIZED === 1, pac);
  const withUser = await c.payroll.count({ where: { month: PERIOD, status: "FINALIZED", employee: { user: { isNot: null } } } });
  const slips = await c.notification.count({ where: { type: "PAYSLIP_READY", createdAt: { gte: since }, message: { contains: PERIOD } } });
  check(`${PERIOD} one PAYSLIP_READY notification per finalized employee with an account`, slips === withUser, { notifications: slips, finalizedEmployeesWithAccount: withUser });
}

// 4. Advances — the general invariant, for every advance issued since the snapshot:
// balance = principal − every installment finalized after it was issued, each
// installment = min(monthly, what was still owed), CLOSED exactly when it hits 0.
{
  const issued = await c.salaryAdvance.findMany({ where: { issuedAt: { gte: since } } });
  const bad: unknown[] = [];
  for (const adv of issued) {
    const recovered = await c.payroll.findMany({ where: { employeeId: adv.employeeId, status: "FINALIZED", finalizedAt: { gte: adv.issuedAt }, loanDeduction: { gt: 0 } }, orderBy: { month: "asc" }, select: { month: true, loanDeduction: true } });
    let owed = adv.principalAmount;
    const steps = recovered.map((r) => { const want = Prisma.Decimal.min(adv.monthlyDeduction, owed); const ok = r.loanDeduction.equals(want); owed = owed.minus(r.loanDeduction); return { month: r.month, deducted: r.loanDeduction.toFixed(2), expected: want.toFixed(2), ok }; });
    if (!adv.remainingBalance.equals(owed) || steps.some((x) => !x.ok) || adv.status !== (owed.lte(0) ? "CLOSED" : "ACTIVE"))
      bad.push({ advance: adv.id, principal: adv.principalAmount.toFixed(2), steps, balance: adv.remainingBalance.toFixed(2), expectedBalance: owed.toFixed(2), status: adv.status });
  }
  const issuedAudit = await c.auditLog.count({ where: { timestamp: { gte: since }, action: "SALARY_ADVANCE_ISSUED" } });
  check("salary advances: balance = principal − finalized installments, closed at zero", bad.length === 0 && issuedAudit === issued.length, { advancesIssuedSinceSnapshot: issued.length, issueAuditRows: issuedAudit, problems: bad });
}
const negAdv = await c.salaryAdvance.count({ where: { remainingBalance: { lt: 0 } } });
check("no advance below zero", negAdv === 0, { negative: negAdv });

const audit = await c.auditLog.groupBy({ by: ["action"], where: { timestamp: { gte: since }, action: { in: ["APPRAISAL_SCORES_COMPUTED", "BULK_EMPLOYEE_IMPORT", "EMPLOYEE_ONBOARDED"] } }, _count: { _all: true } });
const ac = Object.fromEntries(audit.map((x) => [x.action, x._count._all]));
const imported = await c.employee.count({ where: { employeeCode: { startsWith: "LTB-" } } });
check("audit row for appraisal compute and bulk import", ac.APPRAISAL_SCORES_COMPUTED === 1 && ac.BULK_EMPLOYEE_IMPORT === 1 && ac.EMPLOYEE_ONBOARDED === imported, { auditSinceSnapshot: ac, importedEmployees: imported });

// 6. Appraisal compute
const cycle = await c.appraisalCycle.findFirst({ where: { published: false } });
if (cycle) {
  const scored = await c.appraisalScore.findMany({ where: { cycleId: cycle.id }, select: { finalScore: true } });
  const eligible = await c.employee.count({ where: { active: true, ...(cycle.department ? { department: cycle.department } : {}), createdAt: { lt: since } } });
  const out = scored.filter((s) => s.finalScore !== null && (s.finalScore < 0 || s.finalScore > 100)).length;
  check("appraisal: one score per eligible employee, all within 0–100", scored.length >= eligible && out === 0, { scores: scored.length, eligibleAtStart: eligible, outOfRange: out });
}

// 7. Orphans the database does not prevent (FK-backed references are enforced by Postgres)
const orphanActor = await c.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "AuditLog" a WHERE a."timestamp" >= ${since} AND a."actorUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."clerkId" = a."actorUserId" OR u.id = a."actorUserId")`;
const orphanAdj = await c.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Payroll" p WHERE p."adjustmentForPayrollId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Payroll" q WHERE q.id = p."adjustmentForPayrollId")`;
const openPunches = await c.attendance.count({ where: { checkIn: { gte: since }, checkOut: null } });
const noTasks = await c.employee.count({ where: { employeeCode: { startsWith: "LTB-" }, onboardingTasks: { none: {} } } });
check("no orphans", n(orphanActor) === 0 && n(orphanAdj) === 0, { auditRowsWithUnknownActor: n(orphanActor), adjustmentsPointingNowhere: n(orphanAdj), importedEmployeesWithoutOnboardingTasks_byDesignOfImportRoute: noTasks, loadTestPunchesStillOpen: openPunches });

// 8. Reports match the data they summarise
const emps = await c.employee.findMany({ select: { id: true, name: true, employeeCode: true, department: true, active: true, joiningDate: true, offboardedAt: true, shift: { select: { startTime: true, endTime: true } } }, orderBy: { employeeCode: "asc" } });
const scope = { ok: true as const, role: "SUPER_ADMIN" as const, userId: "lt", mode: "org" as const, employees: emps.map((r) => ({ id: r.id, name: r.name, employeeCode: r.employeeCode, department: r.department, active: r.active, joiningDate: r.joiningDate, offboardedAt: r.offboardedAt, shiftCrossesMidnight: shiftCrossesMidnight(r.shift) })), department: null, selfEmployeeId: null, scopeLabel: "org", generatedBy: "lt" };
const report = async (id: string, s: string, e: string) => {
  const r = parseRange(s, e);
  if (!r.ok) throw new Error(r.message);
  const def = REPORTS.find((x) => x.id === id)!;
  const run = await instanceStore.run(c, () => runReport(def.id, scope as never, r.range, { title: def.title, startLabel: r.range.startLabel, endLabel: r.range.endLabel, generatedBy: "lt", generatedAt: new Date(), scopeLabel: "org" }));
  return { result: run.result as Record<string, unknown>, range: r.range };
};
for (const [s, e] of [["2026-10-01", "2026-10-31"], ["2024-10-01", "2026-09-30"]]) {
  const { result } = await report("payroll-cost", s, e);
  const months: string[] = result.months as string[];
  const db = await c.payroll.aggregate({ where: { status: "FINALIZED", month: { in: months } }, _sum: { gross: true, net: true }, _count: { _all: true } });
  const ok = result.finalizedRowCount === db._count._all && result.totalGross === db._sum.gross?.toFixed(2) && result.totalNet === db._sum.net?.toFixed(2);
  check(`report payroll-cost ${s}→${e} = DB`, ok, { report: { rows: result.finalizedRowCount, gross: result.totalGross, net: result.totalNet }, db: { rows: db._count._all, gross: db._sum.gross?.toFixed(2), net: db._sum.net?.toFixed(2) } });
}
{
  const { result, range } = await report("attendance", "2026-10-01", "2026-10-16");
  const where = { date: { gte: range.start, lt: range.endExclusive }, checkIn: { not: null } };
  const [rowsAll, late] = await Promise.all([c.attendance.count({ where }), c.attendance.count({ where: { ...where, lateFlag: true } })]);
  check("report attendance 2026-10-01→16 = DB", result.totalPunchDays === rowsAll && result.lateCount === late, { report: { punchDays: result.totalPunchDays, late: result.lateCount }, db: { punchDays: rowsAll, late } });
}
{
  const { result, range } = await report("production", "2024-10-01", "2026-09-30");
  const db = await c.production.aggregate({ where: { date: { gte: range.start, lt: range.endExclusive } }, _sum: { unitsProduced: true } });
  check("report production 2024-10→2026-09 = DB", result.totalActual === db._sum.unitsProduced, { report: result.totalActual, db: db._sum.unitsProduced });
}
{
  const { result } = await report("headcount", "2026-10-01", "2026-10-16");
  const db = await c.employee.count({ where: { active: true } });
  check("report headcount = DB active employees", result.totalActive === db, { report: result.totalActive, db });
}

console.log(JSON.stringify({ passed: Object.keys(out).length - fails.length, failed: fails, checks: out }, null, 1));
await c.$disconnect();
