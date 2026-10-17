// Harness: scenario "l" — loan recovery through two real payroll months.
import { readFileSync, writeFileSync } from "node:fs";
const f = "scripts/loadtest/harness.ts";
let s = readFileSync(f, "utf8");
const marker = `if (want("f")) {`;
if (!s.includes(marker)) throw new Error("marker");
s = s.replace(marker, `if (want("l")) {
  // Two advances issued exactly as app/api/hr/salary-advance does (opening
  // balance = principal, one ACTIVE advance per employee, SALARY_ADVANCE_ISSUED
  // audit), then two full payroll months: run → submit → finalize. Month 1 is a
  // normal installment for both; month 2 is a normal one for A and the CAPPED
  // final installment for B, which must close it.
  const [inst] = instances(1);
  await warm([inst]);
  const HR1 = HR[0].clerkId, PERIODS = ["2026-11", "2026-12"];
  if (await boot.payroll.count({ where: { month: { in: PERIODS } } })) throw new Error("REFUSING: 2026-11/12 payroll already exists — scenario l runs once");
  const picks = await boot.employee.findMany({
    where: { active: true, salaryStructure: { isNot: null }, salaryAdvances: { none: { status: "ACTIVE" } }, employeeCode: { startsWith: "LT-" } },
    orderBy: { employeeCode: "asc" }, take: 2, select: { id: true, employeeCode: true },
  });
  const plan = [{ principal: "10000.00", monthly: "4000.00" }, { principal: "5000.00", monthly: "3000.00" }];
  const advances = await boot.$transaction(async (tx) => Promise.all(picks.map(async (e, i) => {
    const a = await tx.salaryAdvance.create({ data: { employeeId: e.id, principalAmount: new Prisma.Decimal(plan[i].principal), monthlyDeduction: new Prisma.Decimal(plan[i].monthly), remainingBalance: new Prisma.Decimal(plan[i].principal), issuedBy: HR1 } });
    await tx.auditLog.create({ data: { actorUserId: HR1, action: "SALARY_ADVANCE_ISSUED", targetEntity: a.id } });
    return { ...a, employeeCode: e.employeeCode };
  })));
  const months: unknown[] = [];
  let allOk = true;
  for (const period of PERIODS) {
    const beforeBal = new Map((await boot.salaryAdvance.findMany({ where: { id: { in: advances.map((a) => a.id) } } })).map((a) => [a.id, a]));
    await writeStep(inst, \`l. payroll RUN \${period} (2 active advances)\`, (t) => payrollRun(period, HR1, t));
    await writeStep(inst, \`l. payroll SUBMIT \${period}\`, (t) => payrollSubmit(period, HR1, t));
    const fin = (await writeStep(inst, \`l. payroll FINALIZE \${period}\`, (t) => payrollFinalize(period, SA.clerkId, t))) as { advancesReduced: number; advancesClosed: number } | undefined;
    const rows = await boot.payroll.findMany({ where: { month: period } });
    const after = new Map((await boot.salaryAdvance.findMany({ where: { id: { in: advances.map((a) => a.id) } } })).map((a) => [a.id, a]));
    const checks = advances.map((a) => {
      const b = beforeBal.get(a.id)!, x = after.get(a.id)!, row = rows.find((r) => r.employeeId === a.employeeId)!;
      const expected = Prisma.Decimal.min(b.monthlyDeduction, b.remainingBalance);
      const expectedAfter = b.remainingBalance.minus(expected);
      const arithmetic = row.deductions.equals(row.pfEmployee.plus(row.esi).plus(row.professionalTax).plus(row.tds).plus(row.loanDeduction))
        && row.net.equals(row.gross.minus(row.deductions).plus(row.bonus).plus(row.reimbursements));
      const ok = row.loanDeduction.equals(expected) && x.remainingBalance.equals(expectedAfter) && x.status === (expectedAfter.lte(0) ? "CLOSED" : "ACTIVE") && arithmetic && row.status === "FINALIZED";
      if (!ok) allOk = false;
      return { employee: a.employeeCode, balanceBefore: b.remainingBalance.toFixed(2), installment: b.monthlyDeduction.toFixed(2), deducted: row.loanDeduction.toFixed(2), expected: expected.toFixed(2), balanceAfter: x.remainingBalance.toFixed(2), status: x.status, rowArithmeticExact: arithmetic, ok };
    });
    const others = rows.filter((r) => r.loanDeduction.greaterThan(0) && !advances.some((a) => a.employeeId === r.employeeId)).length;
    const expectClosed = checks.filter((c) => c.status === "CLOSED" && c.balanceBefore !== "0.00").length;
    const finOk = fin?.advancesReduced === 2 && fin?.advancesClosed === expectClosed && others === 0;
    if (!finOk) allOk = false;
    months.push({ period, rows: rows.length, finalize: fin, otherRowsWithLoanDeduction: others, checks });
  }
  const r = { scenario: "l. loan recovery — 2 advances, 2 payroll months", ok: allOk, months };
  results.push(r as never);
  console.log(JSON.stringify(r, null, 1));
  await closeAll([inst]);
}

${marker}`);
writeFileSync(f, s);
console.log("ok");
