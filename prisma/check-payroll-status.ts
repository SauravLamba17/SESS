/**
 * Read-only payroll status check. Writes nothing — safe to run any time.
 *
 * Answers "where is my payroll run actually sitting?" from the database
 * directly, rather than inferring it from the UI.
 *
 * Run:  node --env-file=.env prisma/check-payroll-status.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const rows = await db.payroll.findMany({
    include: { employee: { select: { name: true, employeeCode: true } } },
    orderBy: [{ month: "desc" }, { status: "asc" }],
  });

  console.log("── PAYROLL ROWS ──────────────────────────────────────");
  if (rows.length === 0) {
    console.log("  NO PAYROLL ROWS EXIST AT ALL.");
    console.log("  → Nothing has been created yet. On /hr/payroll pick the");
    console.log("    period, then run 'Step 1 · Create payroll run'.");
  }
  for (const r of rows) {
    const tag = r.isFinalSettlement
      ? " [F&F]"
      : r.adjustmentForPayrollId
        ? " [ADJUSTMENT]"
        : "";
    console.log(
      `  ${r.month}  ${r.employee.employeeCode.padEnd(10)} ${r.employee.name.padEnd(14)} ` +
        `${r.status.padEnd(10)} net=${r.net.toFixed(2).padStart(10)}${tag}`,
    );
  }

  const byStatus = await db.payroll.groupBy({ by: ["status"], _count: { _all: true } });
  const count = (s: string) =>
    byStatus.find((b) => b.status === s)?._count._all ?? 0;

  console.log("\n── WORKFLOW STATE ────────────────────────────────────");
  console.log(`  DRAFT     : ${count("DRAFT")}   (HR editable; NOT visible to Super Admin)`);
  console.log(`  SUBMITTED : ${count("SUBMITTED")}   (appears on the Super Admin finalize page)`);
  console.log(`  FINALIZED : ${count("FINALIZED")}   (locked, payslips downloadable)`);

  if (count("DRAFT") > 0 && count("SUBMITTED") === 0) {
    console.log(
      "\n  ⚠  You have DRAFT rows but nothing SUBMITTED. This is the most",
    );
    console.log("     common reason a run is 'missing' from the Super Admin page:");
    console.log("     draft rows are deliberately invisible there. On /hr/payroll");
    console.log("     click 'Step 2 · Submit run for approval'.");
  }

  console.log("\n── ACTIVE EMPLOYEES / SALARY STRUCTURE ───────────────");
  const emps = await db.employee.findMany({
    where: { active: true },
    select: { name: true, employeeCode: true, salaryStructure: { select: { basic: true } } },
    orderBy: { employeeCode: "asc" },
  });
  for (const e of emps) {
    console.log(
      `  ${e.employeeCode.padEnd(10)} ${e.name.padEnd(14)} ` +
        (e.salaryStructure
          ? `structure set (basic ${e.salaryStructure.basic.toFixed(2)})`
          : "NO STRUCTURE — will be skipped by every payroll run"),
    );
  }

  console.log("\n── RECENT PAYROLL AUDIT TRAIL ────────────────────────");
  const audit = await db.auditLog.findMany({
    where: { action: { startsWith: "PAYROLL" } },
    orderBy: { timestamp: "desc" },
    take: 10,
  });
  if (audit.length === 0) {
    console.log("  No PAYROLL_* audit entries — no run has ever been created,");
    console.log("  submitted or finalized on this database.");
  }
  for (const a of audit) {
    console.log(`  ${a.timestamp.toISOString()}  ${a.action.padEnd(28)} ${a.targetEntity}`);
  }

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("FAILED:", err);
  await db.$disconnect();
  process.exit(1);
});
