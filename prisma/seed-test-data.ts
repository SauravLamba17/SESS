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
