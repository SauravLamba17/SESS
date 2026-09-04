/**
 * Post-finalization correction workflow verification.
 *
 * Runs against the REAL database with the real Prisma client and the real pure
 * compute function. Creates its own throwaway employee and deletes everything
 * it created, pass or fail.
 *
 * Run:  node --env-file=.env prisma/verify-payroll-adjustment.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { notifyEmployee } from "../lib/notify.ts";
import { computeGrossNet } from "../lib/payroll/compute.ts";
import { linkAdjustments } from "../lib/payroll/adjustments.ts";

const db = new PrismaClient();

const CODE = "ZZ-ADJUSTMENT-TEST";
const HR = "test-adj-hr";
const ADMIN = "test-adj-admin";
const PERIOD = "2019-05";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
}
function step(n: string, title: string) {
  console.log(`\n── ${n}: ${title} ${"─".repeat(Math.max(0, 46 - title.length))}`);
}

/** The exact guard app/api/hr/payroll/adjustment/route.ts applies. */
async function canAdjust(payrollId: string) {
  const row = await db.payroll.findUnique({
    where: { id: payrollId },
    select: { id: true, status: true, adjustmentForPayrollId: true },
  });
  if (!row) return { ok: false as const, code: "NOT_FOUND" };
  if (row.status !== "FINALIZED") return { ok: false as const, code: "NOT_FINALIZED" };
  const open = await db.payroll.findFirst({
    where: { adjustmentForPayrollId: row.id, status: { in: ["DRAFT", "SUBMITTED"] } },
    select: { id: true },
  });
  if (open) return { ok: false as const, code: "ADJUSTMENT_OPEN" };
  return { ok: true as const, code: "OK" };
}

async function cleanup(employeeId?: string) {
  if (!employeeId) return;
  // Notification -> User is an FK now: notifications first, then the User
  // that receives them, then the Employee it links to.
  const u = await db.user.findFirst({ where: { employeeId }, select: { id: true } });
  await db.notification.deleteMany({
    where: { OR: [{ employeeId }, ...(u ? [{ recipientUserId: u.id }] : [])] },
  });
  await db.user.deleteMany({ where: { employeeId } });
  // Adjustments reference originals — delete children before parents.
  await db.payroll.deleteMany({
    where: { employeeId, adjustmentForPayrollId: { not: null } },
  });
  await db.payroll.deleteMany({ where: { employeeId } });
  await db.salaryStructure.deleteMany({ where: { employeeId } });
  await db.employee.deleteMany({ where: { id: employeeId } });
  await db.auditLog.deleteMany({ where: { actorUserId: { in: [HR, ADMIN] } } });
}

async function main() {
  let employeeId: string | undefined;

  try {
    const stale = await db.employee.findUnique({ where: { employeeCode: CODE } });
    if (stale) await cleanup(stale.id);

    console.log("══ POST-FINALIZATION CORRECTION WORKFLOW ═══════════════");

    // ── SETUP ───────────────────────────────────────────────────────
    step("SETUP", "employee + a FINALIZED payroll row");
    const employee = await db.employee.create({
      data: {
        employeeCode: CODE,
        name: "Adjustment Test",
        department: "QA",
        joiningDate: new Date(2019, 0, 1),
        active: true,
      },
    });
    employeeId = employee.id;
    // The correction notification is delivered to a USER — give the test
    // employee the login they would really have.
    const empUser = await db.user.create({
      data: { clerkId: `${CODE}-clerk`, role: "EMPLOYEE", employeeId },
    });

    const base = computeGrossNet({
      basic: "30000.00", hra: "15000.00", specialAllowance: "5000.00",
      pfEmployee: "1800.00", esi: "0", professionalTax: "200.00",
      tds: "2500.00", loanDeduction: 0, bonus: 0, reimbursements: 0,
    });
    const original = await db.payroll.create({
      data: {
        employeeId, month: PERIOD,
        basic: new Prisma.Decimal("30000.00"),
        hra: new Prisma.Decimal("15000.00"),
        specialAllowance: new Prisma.Decimal("5000.00"),
        daysWorked: 31, daysInMonth: 31,
        pfEmployee: new Prisma.Decimal("1800.00"),
        professionalTax: new Prisma.Decimal("200.00"),
        tds: new Prisma.Decimal("2500.00"),
        tdsSource: "CA-provided, FY2019-20 (test)",
        gross: base.gross, deductions: base.deductions, net: base.net,
        status: "FINALIZED", processedBy: HR,
        finalizedBy: ADMIN, finalizedAt: new Date(2019, 5, 1),
      },
    });
    // net = 50000 - 4500 = 45500
    check("S1 original FINALIZED with exact figures",
      original.status === "FINALIZED" && original.gross.toFixed(2) === "50000.00" &&
        original.net.toFixed(2) === "45500.00",
      `gross=${original.gross.toFixed(2)} deductions=${original.deductions.toFixed(2)} net=${original.net.toFixed(2)}`);

    // ── STEP 5 (guard, checked first — it gates everything else) ─────
    step("STEP 5", "only a FINALIZED row can be adjusted");
    // A DIFFERENT month from the finalized row above, deliberately. This is
    // only a fixture for the "can you adjust a non-FINALIZED row?" guard, and
    // it used to reuse PERIOD out of convenience — which meant the employee
    // held TWO regular rows for one month, the exact double-payment state the
    // partial unique index now forbids
    // (prisma/migrations/20260727120000_payroll_unique_regular_run). The guard
    // being tested does not care which month the row belongs to.
    const GUARD_PERIOD = "2019-06";
    const draftRow = await db.payroll.create({
      data: { employeeId, month: GUARD_PERIOD, status: "DRAFT", processedBy: HR },
    });
    const draftGuard = await canAdjust(draftRow.id);
    check("5a cannot adjust a DRAFT row (→ 409 NOT_FINALIZED)",
      !draftGuard.ok && draftGuard.code === "NOT_FINALIZED", `code=${draftGuard.code}`);

    await db.payroll.updateMany({
      where: { id: draftRow.id }, data: { status: "SUBMITTED" },
    });
    const submittedGuard = await canAdjust(draftRow.id);
    check("5b cannot adjust a SUBMITTED row (→ 409 NOT_FINALIZED)",
      !submittedGuard.ok && submittedGuard.code === "NOT_FINALIZED", `code=${submittedGuard.code}`);
    await db.payroll.deleteMany({ where: { id: draftRow.id } });

    const okGuard = await canAdjust(original.id);
    check("5c CAN adjust a FINALIZED row", okGuard.ok, `code=${okGuard.code}`);

    // ── STEP 1 ──────────────────────────────────────────────────────
    step("STEP 1", "create the adjustment");
    const adjustment = await db.$transaction(async (tx) => {
      const created = await tx.payroll.create({
        data: {
          employeeId: employeeId!,
          month: original.month,
          adjustmentForPayrollId: original.id,
          isFinalSettlement: original.isFinalSettlement,
          daysWorked: original.daysWorked,
          daysInMonth: original.daysInMonth,
          processedBy: HR,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: HR,
          action: "PAYROLL_ADJUSTMENT_CREATED",
          targetEntity: `${created.id} adjusts ${original.id}`,
        },
      });
      return created;
    });

    check("1a adjustment is DRAFT", adjustment.status === "DRAFT", `status=${adjustment.status}`);
    check("1b points at the original", adjustment.adjustmentForPayrollId === original.id);
    check("1c same employee and period",
      adjustment.employeeId === original.employeeId && adjustment.month === original.month,
      `month=${adjustment.month}`);
    check("1d isFinalSettlement matches the original",
      adjustment.isFinalSettlement === original.isFinalSettlement,
      `original=${original.isFinalSettlement} adjustment=${adjustment.isFinalSettlement}`);
    check("1e every money field starts at zero (a delta of 'no change' is 0)",
      adjustment.gross.toFixed(2) === "0.00" && adjustment.net.toFixed(2) === "0.00" &&
        adjustment.basic.toFixed(2) === "0.00" && adjustment.tds.toFixed(2) === "0.00",
      `gross=${adjustment.gross.toFixed(2)} net=${adjustment.net.toFixed(2)}`);

    // ── STEP 5 continued ────────────────────────────────────────────
    step("STEP 5", "no infinite chain off a DRAFT adjustment");
    const chainGuard = await canAdjust(adjustment.id);
    check("5d cannot adjust the DRAFT adjustment (no unbounded chain)",
      !chainGuard.ok && chainGuard.code === "NOT_FINALIZED", `code=${chainGuard.code}`);
    const secondGuard = await canAdjust(original.id);
    check("5e cannot stack a 2nd open adjustment on the same original",
      !secondGuard.ok && secondGuard.code === "ADJUSTMENT_OPEN", `code=${secondGuard.code}`);

    // ── STEP 4 ──────────────────────────────────────────────────────
    step("STEP 4", "audit trail");
    const audit = await db.auditLog.findFirst({
      where: { action: "PAYROLL_ADJUSTMENT_CREATED" },
    });
    check("4a PAYROLL_ADJUSTMENT_CREATED written referencing BOTH ids",
      audit !== null && audit.targetEntity.includes(adjustment.id) &&
        audit.targetEntity.includes(original.id),
      `targetEntity="${audit?.targetEntity}"`);

    // ── EDIT + WORKFLOW ─────────────────────────────────────────────
    step("EDIT", "HR enters the delta (arrears of 2000 basic, 150 TDS)");
    const delta = computeGrossNet({
      basic: "2000.00", hra: "0", specialAllowance: "0",
      pfEmployee: "0", esi: "0", professionalTax: "0",
      tds: "150.00", loanDeduction: 0, bonus: 0, reimbursements: 0,
    });
    await db.payroll.updateMany({
      where: { id: adjustment.id, status: "DRAFT" },
      data: {
        basic: new Prisma.Decimal("2000.00"),
        tds: new Prisma.Decimal("150.00"),
        tdsSource: "CA-provided revision, FY2019-20 (test)",
        gross: delta.gross, deductions: delta.deductions, net: delta.net,
      },
    });
    const edited = await db.payroll.findUnique({ where: { id: adjustment.id } });
    check("E1 delta stored: gross +2000, net +1850",
      edited?.gross.toFixed(2) === "2000.00" && edited?.net.toFixed(2) === "1850.00",
      `gross=${edited?.gross.toFixed(2)} net=${edited?.net.toFixed(2)}`);

    step("WORKFLOW", "adjustment goes through DRAFT→SUBMITTED→FINALIZED");
    const sub = await db.payroll.updateMany({
      where: { id: adjustment.id, status: "DRAFT" },
      data: { status: "SUBMITTED" },
    });
    check("W1 DRAFT→SUBMITTED, exactly 1 row", sub.count === 1, `count=${sub.count}`);

    const editAfterSubmit = await db.payroll.updateMany({
      where: { id: adjustment.id, status: "DRAFT" },
      data: { net: new Prisma.Decimal("999999.99") },
    });
    check("W2 SUBMITTED adjustment is locked to HR edits (→ 409)",
      editAfterSubmit.count === 0, `rows matched=${editAfterSubmit.count}`);

    const fin = await db.$transaction(async (tx) => {
      const upd = await tx.payroll.updateMany({
        where: { id: adjustment.id, status: "SUBMITTED" },
        data: { status: "FINALIZED", finalizedBy: ADMIN, finalizedAt: new Date(2019, 7, 3) },
      });
      await notifyEmployee(
        tx,
        employeeId!,
        "PAYSLIP_READY",
        "A correction to your May 2019 payslip pays an additional ₹1850.00.",
      );
      return upd.count;
    });
    check("W3 SUBMITTED→FINALIZED, exactly 1 row", fin === 1, `count=${fin}`);
    const corrNote = await db.notification.findFirst({
      where: { employeeId, type: "PAYSLIP_READY" },
    });
    check("W3a correction notification addressed to the employee's User",
      corrNote?.recipientUserId === empUser.id && corrNote?.employeeId === employeeId,
      `recipientUserId=${corrNote?.recipientUserId} employeeId=${corrNote?.employeeId}`);

    const tamperAdj = await db.payroll.updateMany({
      where: { id: adjustment.id, status: "DRAFT" },
      data: { net: new Prisma.Decimal("999999.99") },
    });
    check("W4 FINALIZED adjustment is itself immutable (→ 409)",
      tamperAdj.count === 0, `rows matched=${tamperAdj.count}`);

    // ── ORIGINAL UNTOUCHED THROUGHOUT ───────────────────────────────
    step("IMMUTABILITY", "the original never changed");
    const originalNow = await db.payroll.findUnique({ where: { id: original.id } });
    check("I1 original figures byte-identical to creation",
      originalNow?.gross.toFixed(2) === "50000.00" &&
        originalNow?.deductions.toFixed(2) === "4500.00" &&
        originalNow?.net.toFixed(2) === "45500.00" &&
        originalNow?.tds.toFixed(2) === "2500.00",
      `gross=${originalNow?.gross.toFixed(2)} ded=${originalNow?.deductions.toFixed(2)} net=${originalNow?.net.toFixed(2)} tds=${originalNow?.tds.toFixed(2)}`);
    check("I2 original still FINALIZED, same finalizedAt",
      originalNow?.status === "FINALIZED" &&
        originalNow?.finalizedAt?.getTime() === original.finalizedAt?.getTime(),
      `status=${originalNow?.status}`);

    const tamperOrig = await db.payroll.updateMany({
      where: { id: original.id, status: "DRAFT" },
      data: { net: new Prisma.Decimal("1.00") },
    });
    check("I3 original still rejects any edit (→ 409)",
      tamperOrig.count === 0, `rows matched=${tamperOrig.count}`);

    // ── STEP 2 ──────────────────────────────────────────────────────
    step("STEP 2", "both rows exist, linked and traceable");
    const all = await db.payroll.findMany({
      where: { employeeId, status: "FINALIZED" },
      orderBy: { finalizedAt: "asc" },
    });
    check("2a both rows exist", all.length === 2, `rows=${all.length}`);

    const chains = linkAdjustments(all);
    check("2b linkAdjustments returns ONE chain, not two loose rows",
      chains.length === 1, `chains=${chains.length}`);
    check("2c chain root is the original, with 1 adjustment attached",
      chains[0]?.original.id === original.id && chains[0]?.adjustments.length === 1 &&
        chains[0]?.adjustments[0].id === adjustment.id,
      `root=${chains[0]?.original.id === original.id ? "original" : "WRONG"} adjustments=${chains[0]?.adjustments.length}`);

    const combined = all.reduce((s, r) => s.plus(r.net), new Prisma.Decimal(0));
    check("2d original + adjustment nets to the corrected total (45500 + 1850)",
      combined.toFixed(2) === "47350.00", `combined net=${combined.toFixed(2)}`);

    const annualGross = all.reduce((s, r) => s.plus(r.gross), new Prisma.Decimal(0));
    const annualTds = all.reduce((s, r) => s.plus(r.tds), new Prisma.Decimal(0));
    check("2e Form 16 sum stays correct with deltas (gross 52000, TDS 2650)",
      annualGross.toFixed(2) === "52000.00" && annualTds.toFixed(2) === "2650.00",
      `gross=${annualGross.toFixed(2)} tds=${annualTds.toFixed(2)}`);
    check("2f distinct months = 1, so Form 16 doesn't count a corrected month twice",
      new Set(all.map((r) => r.month)).size === 1);

    // ── STEP 5 final ────────────────────────────────────────────────
    step("STEP 5", "a FINALIZED adjustment may itself be corrected");
    const nowChainable = await canAdjust(adjustment.id);
    check("5f once FINALIZED, the adjustment can be corrected in turn",
      nowChainable.ok, `code=${nowChainable.code}`);
    const originalReopened = await canAdjust(original.id);
    check("5g original is adjustable again once no correction is open",
      originalReopened.ok, `code=${originalReopened.code}`);
  } finally {
    console.log("\n── CLEANUP ───────────────────────────────────────────");
    await cleanup(employeeId);
    const leftEmp = await db.employee.count({ where: { employeeCode: CODE } });
    const leftPay = employeeId ? await db.payroll.count({ where: { employeeId } }) : 0;
    check("CLEANUP every test row removed", leftEmp === 0 && leftPay === 0,
      `employees=${leftEmp} payroll=${leftPay}`);
    await db.$disconnect();
  }

  console.log(
    `\n══ ${fail === 0 ? `ALL ${pass} CHECKS PASSED` : `${fail} of ${pass + fail} CHECKS FAILED`} ══`,
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("\nSCRIPT ERROR:", err);
  await db.$disconnect();
  process.exit(1);
});
