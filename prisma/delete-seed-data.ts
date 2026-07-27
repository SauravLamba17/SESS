/**
 * ONE-TIME removal of the four seeded demo accounts and every row referencing
 * them, ahead of this database becoming production.
 *
 * Targets ONLY the seed script's own rows, matched by the employeeCode and
 * clerkId literals in prisma/seed-test-data.ts. Nothing else is touched.
 *
 * ─── ORDERING ─────────────────────────────────────────────────────────────
 * The schema declares NO onDelete rules, so every foreign key is Prisma's
 * default (Restrict). That is a safety feature here: a mis-ordered delete
 * ERRORS rather than silently orphaning. Order below:
 *   1. leaf children keyed on employeeId
 *   2. ExpenseClaim before Payroll   (ExpenseClaim.includedInPayrollId → Payroll)
 *   3. Payroll adjustments before originals (Payroll.adjustmentForPayrollId → Payroll)
 *   4. SurveyResponseRecord — no FK, so the DB would NOT block it; cleaned
 *      explicitly so it cannot be left dangling
 *   5. User rows          (User.employeeId → Employee)
 *   6. Employees with a manager, then the managers themselves
 *
 * DELIBERATELY NOT DELETED:
 *   • AuditLog — append-only compliance trail. 10 rows name the test actors;
 *     they record that something happened and are kept by explicit decision.
 *   • AppraisalFormula, Shift, Holiday, JobRequisition, SystemSetting —
 *     legitimate configuration, not seeded people.
 *
 * Runs inside ONE transaction: it either completes fully or rolls back.
 *
 * Run:  npx tsx prisma/delete-seed-data.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const SEED_CODES = ["EMP-0001", "EMP-0002", "EMP-0003", "EMP-0004"];
const SEED_CLERK_IDS = [
  "test-hr-0001",
  "test-manager-a-0002",
  "test-employee-1-0003",
  "test-employee-2-0004",
];

async function main() {
  const employees = await db.employee.findMany({
    where: { employeeCode: { in: SEED_CODES } },
    select: { id: true, employeeCode: true, name: true, managerId: true },
    orderBy: { employeeCode: "asc" },
  });

  if (employees.length === 0) {
    console.log("No seeded employees found — nothing to do.");
    return;
  }

  console.log("Deleting these seeded accounts:");
  for (const e of employees) console.log(`  ${e.employeeCode}  ${e.name}  (${e.id})`);

  const ids = employees.map((e) => e.id);

  // A non-seeded employee reporting to a seeded manager would be orphaned by
  // this delete. Refuse rather than guess.
  const outsideReports = await db.employee.count({
    where: { managerId: { in: ids }, employeeCode: { notIn: SEED_CODES } },
  });
  if (outsideReports > 0) {
    throw new Error(
      `ABORT: ${outsideReports} non-seeded employee(s) report to a seeded manager. ` +
        `Reassign them before running this.`,
    );
  }

  const w = { employeeId: { in: ids } };
  const deleted: Record<string, number> = {};
  const note = (table: string, r: { count: number }) => {
    deleted[table] = r.count;
  };

  await db.$transaction(async (tx) => {
    // ── 1. leaf children ──────────────────────────────────────────
    note("Attendance", await tx.attendance.deleteMany({ where: w }));
    note("Production", await tx.production.deleteMany({ where: w }));
    note("QualityReport", await tx.qualityReport.deleteMany({ where: w }));
    note("IdleLog", await tx.idleLog.deleteMany({ where: w }));
    note("AgentToken", await tx.agentToken.deleteMany({ where: w }));
    note("ClientMail", await tx.clientMail.deleteMany({ where: w }));
    note("WarningLetter", await tx.warningLetter.deleteMany({ where: w }));
    note("AppraisalScore", await tx.appraisalScore.deleteMany({ where: w }));
    note("SalaryStructure", await tx.salaryStructure.deleteMany({ where: w }));
    note("SalaryStructureHistory", await tx.salaryStructureHistory.deleteMany({ where: w }));
    note("SalaryAdvance", await tx.salaryAdvance.deleteMany({ where: w }));
    note("Notification", await tx.notification.deleteMany({ where: w }));
    note("ConsentRecord", await tx.consentRecord.deleteMany({ where: w }));
    note("LeaveRequest", await tx.leaveRequest.deleteMany({ where: w }));
    note("MonthlyTarget", await tx.monthlyTarget.deleteMany({ where: w }));
    note("OnboardingTask", await tx.onboardingTask.deleteMany({ where: w }));
    note(
      "ShoutOut",
      await tx.shoutOut.deleteMany({
        where: { OR: [{ fromEmployeeId: { in: ids } }, { toEmployeeId: { in: ids } }] },
      }),
    );

    // ── 2. ExpenseClaim BEFORE Payroll ────────────────────────────
    note("ExpenseClaim", await tx.expenseClaim.deleteMany({ where: w }));

    // ── 3. Payroll adjustments before the rows they correct ───────
    note(
      "Payroll (adjustments)",
      await tx.payroll.deleteMany({ where: { ...w, adjustmentForPayrollId: { not: null } } }),
    );
    note("Payroll", await tx.payroll.deleteMany({ where: w }));

    // ── 4. no-FK reference the database would not have blocked ────
    note("SurveyResponseRecord", await tx.surveyResponseRecord.deleteMany({ where: w }));

    // ── 5. User rows (User.employeeId → Employee) ─────────────────
    note(
      "User",
      await tx.user.deleteMany({
        where: { OR: [{ clerkId: { in: SEED_CLERK_IDS } }, { employeeId: { in: ids } }] },
      }),
    );

    // ── 6. reports first, then their managers ─────────────────────
    note(
      "Employee (reports)",
      await tx.employee.deleteMany({
        where: { id: { in: ids }, managerId: { not: null } },
      }),
    );
    note("Employee (managers)", await tx.employee.deleteMany({ where: { id: { in: ids } } }));
  });

  console.log("\n=== DELETED (rows per table) ===");
  let total = 0;
  for (const [table, n] of Object.entries(deleted)) {
    total += n;
    if (n > 0) console.log(`  ${table.padEnd(24)} ${n}`);
  }
  console.log(`  ${"—".repeat(24)} ${"—".repeat(4)}`);
  console.log(`  ${"TOTAL".padEnd(24)} ${total}`);

  const zero = Object.entries(deleted).filter(([, n]) => n === 0).map(([t]) => t);
  console.log(`\n  (0 rows in: ${zero.join(", ")})`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("\nDELETE FAILED — transaction rolled back, nothing changed:\n", e);
    await db.$disconnect();
    process.exit(1);
  });
