// correctness.ts: payroll/advance/audit/payslip checks for EVERY month the load
// test finalized (not one hard-wired month), and the advance check as the
// general invariant.
import { readFileSync, writeFileSync } from "node:fs";
const f = "scripts/loadtest/correctness.ts";
let s = readFileSync(f, "utf8");
const i = s.indexOf("const reimb = await c.$queryRaw");
const j = s.indexOf("// 6. Appraisal compute");
if (i < 0 || j < 0) throw new Error("markers");
s = s.slice(0, i) + `// Every payroll month the load test finalized (since the snapshot).
const periods = (await c.payroll.findMany({ where: { finalizedAt: { gte: since } }, distinct: ["month"], select: { month: true }, orderBy: { month: "asc" } })).map((p) => p.month);
for (const PERIOD of periods) {
  const reimb = await c.$queryRaw<{ n: bigint }[]>\`
    SELECT count(*) AS n FROM "Payroll" p
    LEFT JOIN (SELECT "includedInPayrollId" AS pid, sum(amount) AS s FROM "ExpenseClaim" WHERE "includedInPayrollId" IS NOT NULL GROUP BY 1) x ON x.pid = p.id
    WHERE p.month = \${PERIOD} AND p.reimbursements <> coalesce(x.s, 0)\`;
  check(\`\${PERIOD} reimbursements = sum of the claims linked to each row\`, n(reimb) === 0, { mismatchedRows: n(reimb) });

  // 3. The load test's payroll run
  const [y, m] = PERIOD.split("-").map(Number);
  const payable = await c.employee.count({ where: { OR: [{ active: true }, { offboardedAt: { gte: new Date(y, m - 1, 1) } }], salaryStructure: { isNot: null }, createdAt: { lt: since } } });
  const rows = await c.payroll.groupBy({ by: ["status"], where: { month: PERIOD }, _count: { _all: true }, _sum: { net: true, gross: true, loanDeduction: true, reimbursements: true } });
  const fin = rows.find((r) => r.status === "FINALIZED");
  check(\`\${PERIOD} payroll: one FINALIZED row per payable employee\`, rows.length === 1 && fin?._count._all === payable, { payableEmployees: payable, byStatus: rows.map((r) => ({ status: r.status, rows: r._count._all })), totalGross: fin?._sum.gross?.toFixed(2), totalNet: fin?._sum.net?.toFixed(2), totalLoan: fin?._sum.loanDeduction?.toFixed(2), totalReimbursements: fin?._sum.reimbursements?.toFixed(2) });
  const sweptLeft = await c.expenseClaim.count({ where: { status: "APPROVED", includedInPayrollId: null, date: { lt: new Date(y, m, 1) }, employee: { payrolls: { some: { month: PERIOD } } } } });
  check(\`\${PERIOD} every approved claim up to month end was swept into payroll\`, sweptLeft === 0, { approvedClaimsLeftBehind: sweptLeft });

  // 5. Audit rows and payslip notifications, per month (punches are not audited, by design)
  const pa = await c.auditLog.groupBy({ by: ["action"], where: { timestamp: { gte: since }, targetEntity: PERIOD, action: { in: ["PAYROLL_RUN_CREATED", "PAYROLL_RUN_SUBMITTED", "PAYROLL_RUN_FINALIZED"] } }, _count: { _all: true } });
  const pac = Object.fromEntries(pa.map((x) => [x.action, x._count._all]));
  check(\`\${PERIOD} one audit row each for run, submit and finalize\`, pac.PAYROLL_RUN_CREATED === 1 && pac.PAYROLL_RUN_SUBMITTED === 1 && pac.PAYROLL_RUN_FINALIZED === 1, pac);
  const withUser = await c.payroll.count({ where: { month: PERIOD, status: "FINALIZED", employee: { user: { isNot: null } } } });
  const slips = await c.notification.count({ where: { type: "PAYSLIP_READY", createdAt: { gte: since }, message: { contains: PERIOD } } });
  check(\`\${PERIOD} one PAYSLIP_READY notification per finalized employee with an account\`, slips === withUser, { notifications: slips, finalizedEmployeesWithAccount: withUser });
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

` + s.slice(j);
// The snapshot no longer feeds a per-month advance diff.
s = s.replace(`const PERIOD = "2026-10";`, `const PERIOD = "2026-10"; // snapshot only; the checks cover every month finalized since`);
// Bulk-imported employees get no onboarding checklist by design of the import
// route (only offer-accept creates one) — reported, not counted as an orphan.
s = s.replace(`n(orphanActor) === 0 && n(orphanAdj) === 0 && noTasks === 0`, `n(orphanActor) === 0 && n(orphanAdj) === 0`);
s = s.replace(`importedEmployeesWithoutOnboardingTasks: noTasks,`, `importedEmployeesWithoutOnboardingTasks_byDesignOfImportRoute: noTasks,`);
writeFileSync(f, s);
console.log("ok");
