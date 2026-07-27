/**
 * One-time seed of REAL test Employee + User rows for impersonation-based
 * testing (HR, Manager-A, Employee-1, Employee-2).
 *
 * These four do NOT have real Clerk accounts. Each gets a distinct, clearly
 * fake placeholder clerkId (e.g. "test-hr-0001") — this satisfies the existing
 * `User.clerkId @unique` (non-null) constraint without any schema change, so
 * no migration was needed. Only the real Super Admin keeps a genuine clerkId.
 *
 * Idempotent: upserts by employeeCode / clerkId, safe to re-run.
 *
 * Run: (source .env for DATABASE_URL) then execute the compiled JS.
 */
import { PrismaClient } from "@prisma/client";
import { demoModeEnabled } from "../lib/impersonation.ts";

// ─── SAFETY GUARD — runs before anything else ───────────────────────────────
// This script creates four fake people. Running it against a production
// database would inject demo accounts into real HR data, and each one is an
// impersonation target. The four seeded accounts were deliberately deleted
// before this database went live; nothing should ever put them back by accident.
//
// Placed above `new PrismaClient()` on purpose: when the guard fails, no client
// is constructed, no connection is opened and no query is issued. The process
// exits before the database is touched in any way.
//
// Reuses demoModeEnabled() from lib/impersonation.ts rather than re-testing the
// env var, so "is this a demo deployment?" has exactly one definition — the
// same one gating impersonation. Only the exact string "true" qualifies.
if (!demoModeEnabled()) {
  console.error(
    [
      "",
      "REFUSED: prisma/seed-test-data.ts did not run.",
      "",
      "This script seeds four FAKE employees (EMP-0001…EMP-0004) and four fake",
      "user accounts. It is for a demo/test environment only — never production.",
      "",
      `  DEMO_MODE is currently: ${process.env.DEMO_MODE === undefined ? "<unset>" : JSON.stringify(process.env.DEMO_MODE)}`,
      "",
      "To run it, set DEMO_MODE=true in the environment of a demo deployment",
      "that has its own separate database:",
      "",
      "  DEMO_MODE=true npx tsx prisma/seed-test-data.ts",
      "",
      "No database connection was opened and nothing was modified.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const db = new PrismaClient();

async function main() {
  const dept = "Assembly";

  // Manager-A first — Employee-1/2 need its id for managerId.
  const managerEmp = await db.employee.upsert({
    where: { employeeCode: "EMP-0002" },
    update: { name: "Manager-A", department: dept, active: true, managerId: null },
    create: {
      employeeCode: "EMP-0002",
      name: "Manager-A",
      department: dept,
      designation: "Line Manager",
      joiningDate: new Date("2021-03-01"),
    },
  });

  const hrEmp = await db.employee.upsert({
    where: { employeeCode: "EMP-0001" },
    update: { name: "HR-User", department: "People Ops", active: true },
    create: {
      employeeCode: "EMP-0001",
      name: "HR-User",
      department: "People Ops",
      designation: "HR Generalist",
      joiningDate: new Date("2020-06-15"),
    },
  });

  const emp1 = await db.employee.upsert({
    where: { employeeCode: "EMP-0003" },
    update: { name: "Employee-1", department: dept, active: true, managerId: managerEmp.id },
    create: {
      employeeCode: "EMP-0003",
      name: "Employee-1",
      department: dept,
      designation: "Operator",
      joiningDate: new Date("2023-01-10"),
      managerId: managerEmp.id,
    },
  });

  const emp2 = await db.employee.upsert({
    where: { employeeCode: "EMP-0004" },
    update: { name: "Employee-2", department: dept, active: true, managerId: managerEmp.id },
    create: {
      employeeCode: "EMP-0004",
      name: "Employee-2",
      department: dept,
      designation: "Operator",
      joiningDate: new Date("2023-02-20"),
      managerId: managerEmp.id,
    },
  });

  const users: { clerkId: string; role: "HR" | "MANAGER" | "EMPLOYEE"; employeeId: string }[] = [
    { clerkId: "test-hr-0001", role: "HR", employeeId: hrEmp.id },
    { clerkId: "test-manager-a-0002", role: "MANAGER", employeeId: managerEmp.id },
    { clerkId: "test-employee-1-0003", role: "EMPLOYEE", employeeId: emp1.id },
    { clerkId: "test-employee-2-0004", role: "EMPLOYEE", employeeId: emp2.id },
  ];

  for (const u of users) {
    await db.user.upsert({
      where: { clerkId: u.clerkId },
      update: { role: u.role, employeeId: u.employeeId },
      create: { clerkId: u.clerkId, role: u.role, employeeId: u.employeeId },
    });
  }

  // Report what exists.
  const created = await db.user.findMany({
    where: { clerkId: { in: users.map((u) => u.clerkId) } },
    include: { employee: { select: { employeeCode: true, name: true, department: true, managerId: true } } },
    orderBy: { clerkId: "asc" },
  });
  console.log("=== SEEDED TEST USERS ===");
  for (const u of created) {
    console.log(
      `role=${u.role} clerkId=${u.clerkId} userId=${u.id} employeeId=${u.employeeId} ` +
        `emp=${u.employee?.employeeCode}/${u.employee?.name} mgrId=${u.employee?.managerId ?? "—"}`,
    );
  }
  console.log(`\nManager-A employeeId = ${managerEmp.id}`);
  console.log(`Employee-1 employeeId = ${emp1.id}`);
  console.log(`Employee-2 employeeId = ${emp2.id}`);
  console.log(`HR employeeId         = ${hrEmp.id}`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("SEED FAILED:", e);
    await db.$disconnect();
    process.exit(1);
  });
