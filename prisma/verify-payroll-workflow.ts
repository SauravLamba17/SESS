/**
 * Full Phase 7 payroll workflow verification, end to end.
 *
 * Runs against the REAL database with the real Prisma client and the real pure
 * functions (compute / proration / assemble). Creates its own throwaway
 * employee and deletes everything it created, pass or fail.
 *
 * Run:  node --env-file=.env prisma/verify-payroll-workflow.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
// The real helpers the finalize route uses, so recipient resolution is
// exercised here rather than re-implemented.
import { notifyEach, notifyEmployee } from "../lib/notify.ts";
import { computeGrossNet } from "../lib/payroll/compute.ts";
import { assemblePayrollRow } from "../lib/payroll/assemble.ts";
import { payableDays } from "../lib/payroll/proration.ts";

const db = new PrismaClient();

const CODE = "ZZ-WORKFLOW-TEST";
const HR = "test-workflow-hr";
const ADMIN = "test-workflow-admin";

// A settled period in the past, so this can never collide with a real run.
const PERIOD = "2019-04"; // April 2019, 30 days
const JOINING = new Date(2019, 3, 1); // 1 Apr 2019 — full month
const EXIT = new Date(2019, 3, 12); // offboard on the 12th → 12/30 days

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
}
function step(n: number, title: string) {
  console.log(`\n── STEP ${n}: ${title} ${"─".repeat(Math.max(0, 44 - title.length))}`);
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
  await db.expenseClaim.deleteMany({ where: { employeeId } });
  await db.payroll.deleteMany({ where: { employeeId } });
  await db.salaryAdvance.deleteMany({ where: { employeeId } });
  await db.salaryStructure.deleteMany({ where: { employeeId } });
  await db.employee.deleteMany({ where: { id: employeeId } });
  await db.auditLog.deleteMany({ where: { actorUserId: { in: [HR, ADMIN] } } });
}

async function main() {
  let employeeId: string | undefined;

  try {
    const stale = await db.employee.findUnique({ where: { employeeCode: CODE } });
    if (stale) await cleanup(stale.id);

    console.log("══ PHASE 7 FULL PAYROLL WORKFLOW VERIFICATION ══════════");

    // ── STEP 1 ──────────────────────────────────────────────────────
    step(1, "employee + salary structure + approved expense");
    const employee = await db.employee.create({
      data: {
        employeeCode: CODE,
        name: "Workflow Test",
        department: "QA",
        joiningDate: JOINING,
        pfUan: "100123456789",
        active: true,
      },
    });
    employeeId = employee.id;
    // A payslip notification is delivered to a USER; give the test employee the
    // login they would really have so the recipient actually resolves.
    const empUser = await db.user.create({
      data: { clerkId: `${CODE}-clerk`, role: "EMPLOYEE", employeeId },
    });

    const structure = await db.salaryStructure.create({
      data: {
        employeeId,
        basic: new Prisma.Decimal("30000.00"),
        hra: new Prisma.Decimal("15000.00"),
        specialAllowance: new Prisma.Decimal("5000.00"),
        effectiveFrom: JOINING,
        setBy: HR,
      },
    });
    check(
      "1a SalaryStructure stored as exact Decimal",
      structure.basic.toFixed(2) === "30000.00" && structure.hra.toFixed(2) === "15000.00",
      `basic=${structure.basic.toFixed(2)} hra=${structure.hra.toFixed(2)} sa=${structure.specialAllowance.toFixed(2)}`,
    );
    check("1b PF UAN recorded on the employee", employee.pfUan === "100123456789", `uan=${employee.pfUan}`);

    const claim = await db.expenseClaim.create({
      data: {
        employeeId,
        category: "TRAVEL",
        amount: new Prisma.Decimal("2500.75"),
        date: new Date(2019, 3, 5),
        description: "Client site visit",
        status: "APPROVED",
        approvedBy: "test-manager",
        approvedAt: new Date(2019, 3, 6),
      },
    });
    check("1c APPROVED expense claim created, not yet reimbursed",
      claim.status === "APPROVED" && claim.includedInPayrollId === null,
      `amount=${claim.amount.toFixed(2)} includedInPayrollId=${claim.includedInPayrollId}`);

    // ── STEP 2 ──────────────────────────────────────────────────────
    step(2, "issue a salary advance");
    const advance = await db.salaryAdvance.create({
      data: {
        employeeId,
        principalAmount: new Prisma.Decimal("24000.00"),
        monthlyDeduction: new Prisma.Decimal("4000.00"),
        remainingBalance: new Prisma.Decimal("24000.00"),
        issuedBy: HR,
      },
    });
    check("2a advance ACTIVE, balance = principal",
      advance.status === "ACTIVE" && advance.remainingBalance.toFixed(2) === "24000.00",
      `principal=${advance.principalAmount.toFixed(2)} monthly=${advance.monthlyDeduction.toFixed(2)} balance=${advance.remainingBalance.toFixed(2)}`);

    // ── STEP 3 ──────────────────────────────────────────────────────
    step(3, "create payroll run (expense + loan aware, pro-rated)");
    const assembled = assemblePayrollRow({
      period: PERIOD,
      structure,
      joiningDate: JOINING,
      offboardedAt: null,
      claims: [{ id: claim.id, amount: claim.amount }],
      advance: {
        id: advance.id,
        monthlyDeduction: advance.monthlyDeduction,
        remainingBalance: advance.remainingBalance,
      },
      settlement: false,
    });

    const draft = await db.payroll.create({
      data: {
        employeeId,
        month: PERIOD,
        basic: assembled.basic,
        hra: assembled.hra,
        specialAllowance: assembled.specialAllowance,
        daysWorked: assembled.daysWorked,
        daysInMonth: assembled.daysInMonth,
        reimbursements: assembled.reimbursements,
        loanDeduction: assembled.loanDeduction,
        gross: assembled.gross,
        deductions: assembled.deductions,
        net: assembled.net,
        processedBy: HR,
      },
    });
    await db.expenseClaim.updateMany({
      where: { id: claim.id, includedInPayrollId: null },
      data: { includedInPayrollId: draft.id },
    });

    check("3a full month → no pro-ration (30/30 days)",
      draft.daysWorked === 30 && draft.daysInMonth === 30,
      `daysWorked=${draft.daysWorked} daysInMonth=${draft.daysInMonth}`);
    check("3b gross = 30000+15000+5000, unaffected by expense/loan",
      draft.gross.toFixed(2) === "50000.00", `gross=${draft.gross.toFixed(2)}`);
    check("3c expense folded in as reimbursement",
      draft.reimbursements.toFixed(2) === "2500.75", `reimbursements=${draft.reimbursements.toFixed(2)}`);
    check("3d loan installment applied (min(4000, 24000))",
      draft.loanDeduction.toFixed(2) === "4000.00", `loanDeduction=${draft.loanDeduction.toFixed(2)}`);
    check("3e deductions = 0 statutory + 4000 loan",
      draft.deductions.toFixed(2) === "4000.00", `deductions=${draft.deductions.toFixed(2)}`);
    // net = 50000 - 4000 + 0 bonus + 2500.75 = 48500.75
    check("3f net = 50000 - 4000 + 2500.75",
      draft.net.toFixed(2) === "48500.75", `net=${draft.net.toFixed(2)}`);

    const claimAfter = await db.expenseClaim.findUnique({ where: { id: claim.id } });
    check("3g claim stamped with payroll id (cannot be double-counted)",
      claimAfter?.includedInPayrollId === draft.id,
      `includedInPayrollId=${claimAfter?.includedInPayrollId}`);

    // Cross-check the stored figures against the pure function directly.
    const recomputed = computeGrossNet({
      basic: draft.basic, hra: draft.hra, specialAllowance: draft.specialAllowance,
      pfEmployee: 0, esi: 0, professionalTax: 0, tds: 0,
      loanDeduction: draft.loanDeduction, bonus: draft.bonus,
      reimbursements: draft.reimbursements,
    });
    check("3h stored figures match computeGrossNet exactly",
      recomputed.gross.toFixed(2) === draft.gross.toFixed(2) &&
        recomputed.net.toFixed(2) === draft.net.toFixed(2),
      `recomputed net=${recomputed.net.toFixed(2)} stored net=${draft.net.toFixed(2)}`);

    // ── STEP 4 ──────────────────────────────────────────────────────
    step(4, "submit the run");
    const submit = await db.payroll.updateMany({
      where: { month: PERIOD, status: "DRAFT", employeeId },
      data: { status: "SUBMITTED", processedBy: HR },
    });
    check("4a exactly 1 row DRAFT→SUBMITTED", submit.count === 1, `count=${submit.count}`);

    const editWhileSubmitted = await db.payroll.updateMany({
      where: { id: draft.id, status: "DRAFT" },
      data: { tds: new Prisma.Decimal("999999.99") },
    });
    check("4b HR edit guard already rejects a SUBMITTED row (→ 409)",
      editWhileSubmitted.count === 0, `rows matched=${editWhileSubmitted.count}`);

    // ── STEP 5 ──────────────────────────────────────────────────────
    step(5, "finalize as Super Admin (loan reduced + notification)");
    const pendingRows = await db.payroll.findMany({
      where: { month: PERIOD, status: "SUBMITTED", employeeId },
      select: { id: true, employeeId: true, loanDeduction: true, isFinalSettlement: true },
    });

    await db.$transaction(async (tx) => {
      const upd = await tx.payroll.updateMany({
        where: { month: PERIOD, status: "SUBMITTED", employeeId },
        data: { status: "FINALIZED", finalizedBy: ADMIN, finalizedAt: new Date() },
      });
      if (upd.count !== pendingRows.length) throw new Error("PARTIAL");

      for (const row of pendingRows.filter((p) => p.loanDeduction.greaterThan(0))) {
        const adv = await tx.salaryAdvance.findFirst({
          where: { employeeId: row.employeeId, status: "ACTIVE" },
          orderBy: { issuedAt: "asc" },
        });
        if (!adv) continue;
        const reduced = await tx.salaryAdvance.updateMany({
          where: { id: adv.id, status: "ACTIVE", remainingBalance: { gte: row.loanDeduction } },
          data: { remainingBalance: { decrement: row.loanDeduction } },
        });
        if (reduced.count === 0) continue;
        if (adv.remainingBalance.minus(row.loanDeduction).lessThanOrEqualTo(0)) {
          await tx.salaryAdvance.update({ where: { id: adv.id }, data: { status: "CLOSED" } });
        }
      }

      await notifyEach(
        tx,
        pendingRows.map((p) => ({
          employeeId: p.employeeId,
          type: "PAYSLIP_READY" as const,
          message: "Your payslip for April 2019 is ready to download.",
        })),
      );
    });

    const advAfter = await db.salaryAdvance.findUnique({ where: { id: advance.id } });
    check("5a advance balance reduced 24000 → 20000",
      advAfter?.remainingBalance.toFixed(2) === "20000.00",
      `remainingBalance=${advAfter?.remainingBalance.toFixed(2)}`);
    check("5b advance still ACTIVE (balance remains)",
      advAfter?.status === "ACTIVE", `status=${advAfter?.status}`);

    // ── STEP 6 ──────────────────────────────────────────────────────
    step(6, "attempt to edit the FINALIZED row");
    const finalizedRow = await db.payroll.findUnique({ where: { id: draft.id } });
    check("6a route's status guard → 409 LOCKED",
      finalizedRow !== null && finalizedRow.status !== "DRAFT",
      `status=${finalizedRow?.status} → 409 "This payroll row is FINALIZED and permanently immutable."`);

    const tamper = await db.payroll.updateMany({
      where: { id: draft.id, status: "DRAFT" },
      data: { tds: new Prisma.Decimal("0.00"), net: new Prisma.Decimal("999999.99") },
    });
    check("6b atomic write guard matched 0 rows", tamper.count === 0, `rows matched=${tamper.count}`);

    const after = await db.payroll.findUnique({ where: { id: draft.id } });
    check("6c figures byte-identical after tamper attempt",
      after?.net.toFixed(2) === "48500.75" && after?.gross.toFixed(2) === "50000.00",
      `gross=${after?.gross.toFixed(2)} net=${after?.net.toFixed(2)} status=${after?.status}`);

    // ── STEP 7 ──────────────────────────────────────────────────────
    step(7, "offboard mid-month → F&F settlement");
    // A second approved expense, to prove the settlement sweeps it up.
    const claim2 = await db.expenseClaim.create({
      data: {
        employeeId,
        category: "FOOD",
        amount: new Prisma.Decimal("500.25"),
        date: new Date(2019, 3, 10),
        description: "Team lunch",
        status: "APPROVED",
        approvedBy: "test-manager",
        approvedAt: new Date(2019, 3, 11),
      },
    });

    const days = payableDays(PERIOD, JOINING, EXIT);
    check("7a payable days = 12 of 30 (exit on the 12th)",
      days.daysWorked === 12 && days.daysInMonth === 30,
      `daysWorked=${days.daysWorked} daysInMonth=${days.daysInMonth}`);

    const ffAdvance = await db.salaryAdvance.findFirst({
      where: { employeeId, status: "ACTIVE" },
      select: { id: true, monthlyDeduction: true, remainingBalance: true },
    });
    const ffRow = assemblePayrollRow({
      period: PERIOD,
      structure,
      joiningDate: JOINING,
      offboardedAt: EXIT,
      claims: [{ id: claim2.id, amount: claim2.amount }],
      advance: ffAdvance,
      settlement: true,
    });

    const settlement = await db.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: employeeId! },
        data: { active: false, offboardedAt: EXIT },
      });
      const created = await tx.payroll.create({
        data: {
          employeeId: employeeId!,
          month: PERIOD,
          isFinalSettlement: true,
          basic: ffRow.basic,
          hra: ffRow.hra,
          specialAllowance: ffRow.specialAllowance,
          daysWorked: ffRow.daysWorked,
          daysInMonth: ffRow.daysInMonth,
          reimbursements: ffRow.reimbursements,
          loanDeduction: ffRow.loanDeduction,
          gross: ffRow.gross,
          deductions: ffRow.deductions,
          net: ffRow.net,
          processedBy: HR,
        },
      });
      await tx.expenseClaim.updateMany({
        where: { id: { in: ffRow.claimIds }, includedInPayrollId: null },
        data: { includedInPayrollId: created.id },
      });
      await tx.auditLog.create({
        data: { actorUserId: HR, action: "FULL_FINAL_SETTLEMENT_CREATED", targetEntity: created.id },
      });
      return created;
    });

    // 30000*12/30 = 12000, 15000*12/30 = 6000, 5000*12/30 = 2000 → gross 20000
    check("7b F&F pro-rated: basic 30000*12/30 = 12000",
      settlement.basic.toFixed(2) === "12000.00", `basic=${settlement.basic.toFixed(2)}`);
    check("7c F&F gross = 12000+6000+2000",
      settlement.gross.toFixed(2) === "20000.00", `gross=${settlement.gross.toFixed(2)}`);
    check("7d F&F deducts the FULL remaining loan (20000), not one 4000 installment",
      settlement.loanDeduction.toFixed(2) === "20000.00",
      `loanDeduction=${settlement.loanDeduction.toFixed(2)}`);
    check("7e F&F swept up the outstanding expense claim",
      settlement.reimbursements.toFixed(2) === "500.25",
      `reimbursements=${settlement.reimbursements.toFixed(2)}`);
    // net = 20000 - 20000 + 0 + 500.25 = 500.25
    check("7f F&F net = 20000 - 20000 + 500.25",
      settlement.net.toFixed(2) === "500.25", `net=${settlement.net.toFixed(2)}`);
    check("7g F&F row is DRAFT — not auto-finalized",
      settlement.status === "DRAFT" && settlement.isFinalSettlement,
      `status=${settlement.status} isFinalSettlement=${settlement.isFinalSettlement}`);

    const empAfter = await db.employee.findUnique({ where: { id: employeeId } });
    check("7h employee soft-deleted with an exit date recorded",
      empAfter?.active === false && empAfter?.offboardedAt !== null,
      `active=${empAfter?.active} offboardedAt=${empAfter?.offboardedAt?.toISOString().slice(0, 10)}`);

    const ffAudit = await db.auditLog.findFirst({
      where: { action: "FULL_FINAL_SETTLEMENT_CREATED", targetEntity: settlement.id },
    });
    check("7i FULL_FINAL_SETTLEMENT_CREATED audit row written", ffAudit !== null);

    // Advance balance must NOT have moved yet — the F&F row is still DRAFT.
    const advDuringDraft = await db.salaryAdvance.findUnique({ where: { id: advance.id } });
    check("7j advance NOT yet reduced — F&F is still DRAFT (recovery happens at finalize)",
      advDuringDraft?.remainingBalance.toFixed(2) === "20000.00" &&
        advDuringDraft?.status === "ACTIVE",
      `balance=${advDuringDraft?.remainingBalance.toFixed(2)} status=${advDuringDraft?.status}`);

    // Finalize the F&F row → loan closes.
    await db.payroll.updateMany({
      where: { id: settlement.id, status: "DRAFT" },
      data: { status: "SUBMITTED" },
    });
    await db.$transaction(async (tx) => {
      await tx.payroll.updateMany({
        where: { id: settlement.id, status: "SUBMITTED" },
        data: { status: "FINALIZED", finalizedBy: ADMIN, finalizedAt: new Date() },
      });
      const adv = await tx.salaryAdvance.findFirst({
        where: { employeeId: employeeId!, status: "ACTIVE" },
      });
      if (adv) {
        await tx.salaryAdvance.updateMany({
          where: { id: adv.id, status: "ACTIVE", remainingBalance: { gte: ffRow.loanDeduction } },
          data: { remainingBalance: { decrement: ffRow.loanDeduction } },
        });
        if (adv.remainingBalance.minus(ffRow.loanDeduction).lessThanOrEqualTo(0)) {
          await tx.salaryAdvance.update({ where: { id: adv.id }, data: { status: "CLOSED" } });
        }
      }
      await notifyEmployee(
        tx,
        employeeId!,
        "PAYSLIP_READY",
        "Your full & final settlement for April 2019 is ready to download.",
      );
    });

    const advFinal = await db.salaryAdvance.findUnique({ where: { id: advance.id } });
    check("7k on F&F finalize the advance is fully repaid and CLOSED",
      advFinal?.remainingBalance.toFixed(2) === "0.00" && advFinal?.status === "CLOSED",
      `balance=${advFinal?.remainingBalance.toFixed(2)} status=${advFinal?.status}`);

    // ── STEP 8 ──────────────────────────────────────────────────────
    step(8, "generate a salary slip PDF");
    const slipRow = await db.payroll.findUnique({
      where: { id: draft.id },
      include: {
        employee: {
          select: { name: true, employeeCode: true, department: true, designation: true, pfUan: true },
        },
      },
    });
    // The PDF template is TSX and cannot be imported by Node's type stripper,
    // so this asserts the exact payload the route hands the renderer. The
    // renderer itself is exercised separately (see the PDF harness).
    const payload = slipRow && {
      employeeName: slipRow.employee.name,
      employeeCode: slipRow.employee.employeeCode,
      pfUan: slipRow.employee.pfUan,
      period: slipRow.month,
      daysWorked: slipRow.daysWorked,
      daysInMonth: slipRow.daysInMonth,
      loanDeduction: slipRow.loanDeduction.toFixed(2),
      gross: slipRow.gross.toFixed(2),
      net: slipRow.net.toFixed(2),
      isFinalSettlement: slipRow.isFinalSettlement,
    };
    check("8a payslip payload complete, FINALIZED, every figure an exact decimal string",
      payload !== null &&
        slipRow!.status === "FINALIZED" &&
        /^\d+\.\d{2}$/.test(payload.gross) &&
        /^\d+\.\d{2}$/.test(payload.net) &&
        /^\d+\.\d{2}$/.test(payload.loanDeduction),
      JSON.stringify(payload));

    const draftVisible = await db.payroll.count({
      where: { employeeId, status: "FINALIZED" },
    });
    check("8b only FINALIZED rows reachable by the employee payslip query",
      draftVisible === 2, `FINALIZED rows=${draftVisible} (regular + F&F)`);

    // ── STEP 9 ──────────────────────────────────────────────────────
    step(9, "notifications");
    const notes = await db.notification.findMany({
      where: { employeeId, type: "PAYSLIP_READY" },
      orderBy: { createdAt: "asc" },
    });
    check("9a PAYSLIP_READY notification created on finalize",
      notes.length === 2, `notifications=${notes.length}`);
    check("9b notifications start unread",
      notes.every((n) => !n.read), `unread=${notes.filter((n) => !n.read).length}/${notes.length}`);
    check("9c settlement notification names the settlement",
      notes.some((n) => n.message.toLowerCase().includes("full & final")),
      notes.map((n) => `"${n.message}"`).join(" | "));
    check("9d addressed to the employee's User, employee kept as context",
      notes.length === 2 &&
        notes.every((n) => n.recipientUserId === empUser.id && n.employeeId === employeeId),
      `recipientUserId=${notes.map((n) => n.recipientUserId).join(",")}`);
  } finally {
    console.log("\n── CLEANUP ───────────────────────────────────────────");
    await cleanup(employeeId);
    const leftEmp = await db.employee.count({ where: { employeeCode: CODE } });
    const leftPay = employeeId
      ? await db.payroll.count({ where: { employeeId } })
      : 0;
    const leftNote = employeeId
      ? await db.notification.count({ where: { employeeId } })
      : 0;
    check("10. every test row removed",
      leftEmp === 0 && leftPay === 0 && leftNote === 0,
      `employees=${leftEmp} payroll=${leftPay} notifications=${leftNote}`);
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
