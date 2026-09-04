/**
 * READ-ONLY global orphan sweep. Deletes nothing.
 *
 * For every table carrying an employeeId (or an Employee id in a plain string
 * column), checks that the referenced Employee still exists. Catches both:
 *   • FK-backed columns — should be impossible to orphan, verified anyway
 *   • NO-FK columns (SurveyResponseRecord.employeeId, Offer.proposedManagerId)
 *     which the database does NOT protect and which a delete could dangle
 *
 * Run:  npx tsx prisma/audit-orphans.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const employees = await db.employee.findMany({ select: { id: true } });
  const live = new Set(employees.map((e) => e.id));
  console.log(`Employee rows currently in the database: ${live.size}\n`);

  const rowsOf = async (
    table: string,
    fetch: () => Promise<{ employeeId: string }[]>,
  ): Promise<[string, number, number]> => {
    const rows = await fetch();
    const orphans = rows.filter((r) => !live.has(r.employeeId)).length;
    return [table, rows.length, orphans];
  };

  const results: [string, number, number][] = [
    await rowsOf("Attendance", () => db.attendance.findMany({ select: { employeeId: true } })),
    await rowsOf("Production", () => db.production.findMany({ select: { employeeId: true } })),
    await rowsOf("QualityReport", () => db.qualityReport.findMany({ select: { employeeId: true } })),
    await rowsOf("IdleLog", () => db.idleLog.findMany({ select: { employeeId: true } })),
    await rowsOf("AgentToken", () => db.agentToken.findMany({ select: { employeeId: true } })),
    await rowsOf("ClientMail", () => db.clientMail.findMany({ select: { employeeId: true } })),
    await rowsOf("WarningLetter", () => db.warningLetter.findMany({ select: { employeeId: true } })),
    await rowsOf("AppraisalScore", () => db.appraisalScore.findMany({ select: { employeeId: true } })),
    await rowsOf("Payroll", () => db.payroll.findMany({ select: { employeeId: true } })),
    await rowsOf("SalaryStructure", () => db.salaryStructure.findMany({ select: { employeeId: true } })),
    await rowsOf("SalaryStructureHistory", () =>
      db.salaryStructureHistory.findMany({ select: { employeeId: true } }),
    ),
    await rowsOf("ExpenseClaim", () => db.expenseClaim.findMany({ select: { employeeId: true } })),
    await rowsOf("SalaryAdvance", () => db.salaryAdvance.findMany({ select: { employeeId: true } })),
    await rowsOf("ConsentRecord", () => db.consentRecord.findMany({ select: { employeeId: true } })),
    await rowsOf("LeaveRequest", () => db.leaveRequest.findMany({ select: { employeeId: true } })),
    await rowsOf("MonthlyTarget", () => db.monthlyTarget.findMany({ select: { employeeId: true } })),
    await rowsOf("OnboardingTask", () => db.onboardingTask.findMany({ select: { employeeId: true } })),
    // NO FOREIGN KEY — the database does not protect this one.
    await rowsOf("SurveyResponseRecord *", () =>
      db.surveyResponseRecord.findMany({ select: { employeeId: true } }),
    ),
  ];

  console.log("Table                      rows   orphaned");
  console.log("─────────────────────────────────────────────");
  let totalOrphans = 0;
  for (const [table, rows, orphans] of results) {
    totalOrphans += orphans;
    console.log(
      `${orphans > 0 ? "✗" : " "} ${table.padEnd(24)} ${String(rows).padStart(4)}   ${String(orphans).padStart(4)}`,
    );
  }

  // Notification.employeeId is NULLABLE now — it is optional HR context, not a
  // recipient. A null is a system/role-addressed alert that concerns no
  // employee, which is a valid row and NOT an orphan; only a non-null id
  // pointing at a vanished Employee is.
  const notifications = await db.notification.findMany({ select: { employeeId: true } });
  const badNotification = notifications.filter(
    (n) => n.employeeId !== null && !live.has(n.employeeId),
  ).length;
  console.log(
    `${badNotification > 0 ? "✗" : " "} ${"Notification".padEnd(24)} ${String(notifications.length).padStart(4)}   ${String(badNotification).padStart(4)}`,
  );
  totalOrphans += badNotification;

  // Employee self-relation.
  const badManager = (
    await db.employee.findMany({ select: { managerId: true } })
  ).filter((e) => e.managerId !== null && !live.has(e.managerId)).length;
  console.log(`${badManager > 0 ? "✗" : " "} ${"Employee.managerId".padEnd(24)}      ${String(badManager).padStart(4)}`);
  totalOrphans += badManager;

  // User.employeeId (FK, nullable).
  const badUser = (
    await db.user.findMany({ select: { employeeId: true } })
  ).filter((u) => u.employeeId !== null && !live.has(u.employeeId)).length;
  console.log(`${badUser > 0 ? "✗" : " "} ${"User.employeeId".padEnd(24)}      ${String(badUser).padStart(4)}`);
  totalOrphans += badUser;

  // NO FOREIGN KEY.
  const badOffer = (
    await db.offer.findMany({ select: { proposedManagerId: true } })
  ).filter((o) => o.proposedManagerId !== null && !live.has(o.proposedManagerId)).length;
  console.log(`${badOffer > 0 ? "✗" : " "} ${"Offer.proposedManagerId *".padEnd(24)}      ${String(badOffer).padStart(4)}`);
  totalOrphans += badOffer;

  console.log("─────────────────────────────────────────────");
  console.log(`(* = no foreign key; the database would not have blocked an orphan here)`);
  console.log(
    totalOrphans === 0
      ? "\n✓ ZERO orphaned references anywhere."
      : `\n✗ ${totalOrphans} ORPHANED REFERENCE(S) FOUND.`,
  );

  console.log("\n═══ SEED REMNANTS ═══");
  const codes = await db.employee.count({
    where: { employeeCode: { in: ["EMP-0001", "EMP-0002", "EMP-0003", "EMP-0004"] } },
  });
  const clerk = await db.user.count({ where: { clerkId: { startsWith: "test-" } } });
  console.log(`  Employees with a seed employeeCode: ${codes}`);
  console.log(`  Users with a "test-" clerkId:       ${clerk}`);

  console.log("\n═══ CONFIGURATION (must be intact) ═══");
  const [formula, shifts, holidays, reqs, settings, cycles, audit] = await Promise.all([
    db.appraisalFormula.count(),
    db.shift.count(),
    db.holiday.count(),
    db.jobRequisition.count(),
    db.systemSetting.count(),
    db.appraisalCycle.count(),
    db.auditLog.count(),
  ]);
  console.log(`  AppraisalFormula ${formula}`);
  console.log(`  Shift            ${shifts}`);
  console.log(`  Holiday          ${holidays}`);
  console.log(`  JobRequisition   ${reqs}`);
  console.log(`  SystemSetting    ${settings}`);
  console.log(`  AppraisalCycle   ${cycles}`);
  console.log(`  AuditLog         ${audit}  (kept by decision — append-only trail)`);

  if (totalOrphans > 0) process.exitCode = 1;
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("SWEEP FAILED:", e);
    await db.$disconnect();
    process.exit(1);
  });
