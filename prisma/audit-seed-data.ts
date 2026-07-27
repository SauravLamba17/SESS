/**
 * READ-ONLY survey of the seeded demo accounts and everything referencing them.
 * Deletes NOTHING. Run before any cleanup to see exactly what is in scope.
 *
 * Run: npx tsx prisma/audit-seed-data.ts
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
  console.log("═══ SEEDED ACCOUNTS ═══\n");

  const employees = await db.employee.findMany({
    where: { employeeCode: { in: SEED_CODES } },
    include: { user: { select: { id: true, clerkId: true, role: true } } },
    orderBy: { employeeCode: "asc" },
  });

  for (const e of employees) {
    console.log(
      `${e.employeeCode}  ${e.name.padEnd(12)} dept=${e.department.padEnd(12)} ` +
        `active=${e.active} id=${e.id}\n` +
        `           user: ${e.user ? `${e.user.clerkId} (${e.user.role}) id=${e.user.id}` : "— none —"}`,
    );
  }
  const ids = employees.map((e) => e.id);
  console.log(`\nEmployee rows matched: ${employees.length}`);

  // Users matched by clerkId, in case any lost its employee link.
  const usersByClerk = await db.user.findMany({
    where: { clerkId: { in: SEED_CLERK_IDS } },
    select: { id: true, clerkId: true, role: true, employeeId: true },
  });
  console.log(`User rows matched by seed clerkId: ${usersByClerk.length}`);
  for (const u of usersByClerk) {
    console.log(`  ${u.clerkId.padEnd(24)} role=${u.role.padEnd(9)} employeeId=${u.employeeId ?? "— none —"}`);
  }

  if (ids.length === 0) {
    console.log("\nNothing seeded found. Nothing to do.");
    return;
  }

  console.log("\n═══ ROWS REFERENCING THESE EMPLOYEES (by table) ═══\n");

  const w = { employeeId: { in: ids } };
  const counts: [string, number][] = [
    ["Attendance", await db.attendance.count({ where: w })],
    ["Production", await db.production.count({ where: w })],
    ["QualityReport", await db.qualityReport.count({ where: w })],
    ["IdleLog", await db.idleLog.count({ where: w })],
    ["AgentToken", await db.agentToken.count({ where: w })],
    ["ClientMail", await db.clientMail.count({ where: w })],
    ["WarningLetter", await db.warningLetter.count({ where: w })],
    ["AppraisalScore", await db.appraisalScore.count({ where: w })],
    ["Payroll", await db.payroll.count({ where: w })],
    ["SalaryStructure", await db.salaryStructure.count({ where: w })],
    ["SalaryStructureHistory", await db.salaryStructureHistory.count({ where: w })],
    ["ExpenseClaim", await db.expenseClaim.count({ where: w })],
    ["SalaryAdvance", await db.salaryAdvance.count({ where: w })],
    ["Notification", await db.notification.count({ where: w })],
    ["ConsentRecord", await db.consentRecord.count({ where: w })],
    ["LeaveRequest", await db.leaveRequest.count({ where: w })],
    ["MonthlyTarget", await db.monthlyTarget.count({ where: w })],
    ["OnboardingTask", await db.onboardingTask.count({ where: w })],
    [
      "ShoutOut (from or to)",
      await db.shoutOut.count({
        where: { OR: [{ fromEmployeeId: { in: ids } }, { toEmployeeId: { in: ids } }] },
      }),
    ],
    ["User", usersByClerk.length],
  ];

  let total = 0;
  for (const [table, n] of counts) {
    total += n;
    console.log(`${n > 0 ? "→" : " "} ${table.padEnd(24)} ${n}`);
  }

  console.log("\n═══ NO-FOREIGN-KEY REFERENCES (the database will NOT block these) ═══\n");

  // These columns hold an Employee/User id as a plain string with no FK, so a
  // delete succeeds and silently leaves a dangling reference behind.
  const srr = await db.surveyResponseRecord.count({ where: { employeeId: { in: ids } } });
  console.log(`  SurveyResponseRecord.employeeId   ${srr}`);

  const offers = await db.offer.count({ where: { proposedManagerId: { in: ids } } });
  console.log(`  Offer.proposedManagerId           ${offers}`);

  const userIds = usersByClerk.map((u) => u.id);
  const auditByUserId = await db.auditLog.count({ where: { actorUserId: { in: userIds } } });
  const auditByClerkId = await db.auditLog.count({ where: { actorUserId: { in: SEED_CLERK_IDS } } });
  console.log(`  AuditLog.actorUserId (User.id)    ${auditByUserId}`);
  console.log(`  AuditLog.actorUserId (clerkId)    ${auditByClerkId}`);

  console.log("\n═══ BLOCKERS: links to NON-seeded records ═══\n");

  // Anyone outside the seed set reporting to a seeded manager would be
  // orphaned by the delete — must be reassigned first, not silently dropped.
  const outsideReports = await db.employee.findMany({
    where: { managerId: { in: ids }, employeeCode: { notIn: SEED_CODES } },
    select: { employeeCode: true, name: true, managerId: true },
  });
  console.log(
    outsideReports.length === 0
      ? "  none — no non-seeded employee reports to a seeded manager"
      : `  ${outsideReports.length} NON-SEEDED employee(s) report to a seeded manager:`,
  );
  for (const r of outsideReports) console.log(`    ${r.employeeCode} ${r.name}`);

  // Shout-outs pairing a seeded person with a real one.
  const mixedShoutOuts = await db.shoutOut.count({
    where: {
      OR: [
        { fromEmployeeId: { in: ids }, toEmployeeId: { notIn: ids } },
        { toEmployeeId: { in: ids }, fromEmployeeId: { notIn: ids } },
      ],
    },
  });
  console.log(`  ShoutOuts pairing a seeded person with a non-seeded one: ${mixedShoutOuts}`);

  console.log("\n═══ WHAT THE DATABASE HOLDS OVERALL ═══\n");
  const [allEmp, allUsers, allAudit] = await Promise.all([
    db.employee.count(),
    db.user.count(),
    db.auditLog.count(),
  ]);
  console.log(`  Employee total ${allEmp}  (seeded ${employees.length}, other ${allEmp - employees.length})`);
  console.log(`  User total     ${allUsers}  (seeded ${usersByClerk.length}, other ${allUsers - usersByClerk.length})`);
  console.log(`  AuditLog total ${allAudit}`);

  console.log("\n═══ CONFIG THAT MUST SURVIVE (not touched) ═══\n");
  const [formula, shifts, holidays, reqs, settings] = await Promise.all([
    db.appraisalFormula.count(),
    db.shift.count(),
    db.holiday.count(),
    db.jobRequisition.count(),
    db.systemSetting.count(),
  ]);
  console.log(`  AppraisalFormula ${formula}\n  Shift ${shifts}\n  Holiday ${holidays}\n  JobRequisition ${reqs}\n  SystemSetting ${settings}`);

  console.log(`\nTOTAL rows in scope for deletion (FK-linked + User): ${total}`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("AUDIT FAILED:", e);
    await db.$disconnect();
    process.exit(1);
  });
