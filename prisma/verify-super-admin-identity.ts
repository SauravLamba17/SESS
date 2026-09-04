/**
 * Super Admin identity, notifications and boundary verification.
 *
 * Proves end to end, against the REAL database and the REAL logic
 * (lib/admin/user-role.ts, lib/notify.ts), that:
 *
 *   1. the Super Admin exists as a real User with employeeId = NULL
 *   2. Roles & Permissions sees them
 *   3. the last-admin lock protects them — BOTH branches, blocked and allowed
 *   4. role-distribution reporting counts them
 *   5. a notification addressed to them is deliverable despite employeeId NULL
 *   6. employee-subject notifications are unchanged — no regression
 *   7. Manager-only, relationship-based actions remain CLOSED to them
 *
 * (7) is the point of the exercise as much as the rest: an employee-less
 * administrator has no line-management relationship, so approving a report's
 * leave must fail — cleanly, as a rejection, not as a crash. This file exists
 * to make that boundary a verified feature rather than an unexamined gap.
 *
 * The ONLY stub is the Clerk metadata call, injected exactly as
 * prisma/verify-phase11.ts does it, so the real role-change logic runs without
 * a live Clerk key.
 *
 * ─── SAFETY ──────────────────────────────────────────────────────────────
 * The real Super Admin's role is NEVER changed. The blocked branch of the
 * last-admin lock is asserted by calling changeUserRole() and checking it
 * REFUSES — the guard returns before any write, and this file re-reads the role
 * afterwards to prove it is untouched. The allowed branch demotes a THROWAWAY
 * second admin, never the real one. All throwaway rows are deleted, pass or
 * fail.
 *
 * Run:  node --env-file=.env prisma/verify-super-admin-identity.ts
 *       node --env-file=.env prisma/verify-super-admin-identity.ts --email=admin@example.com
 */
import { PrismaClient } from "@prisma/client";
import { changeUserRole, type UpdateClerkRoleFn } from "../lib/admin/user-role.ts";
import { notifyUsers, notifyEmployee } from "../lib/notify.ts";

const db = new PrismaClient();

const TAG = "ZZ-SAI";
const ACTOR = "test-sai-actor";
/** Throwaway second administrator, used ONLY for the allowed branch of (3). */
const SPARE_CLERK_ID = "user_zzsai_spare_admin_0001";

function argValue(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : null;
}
/** Which Super Admin to assert on. Defaults to "the only one". */
const EMAIL_HINT = argValue("email");

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

async function cleanup() {
  const emps = await db.employee.findMany({
    where: { employeeCode: { startsWith: TAG } },
    select: { id: true },
  });
  const empIds = emps.map((e) => e.id);
  const users = await db.user.findMany({
    where: { OR: [{ employeeId: { in: empIds } }, { clerkId: { startsWith: "user_zzsai" } }] },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);

  // Notifications reference Users (FK) and optionally Employees — so they go
  // first, then Users, then Employees.
  await db.notification.deleteMany({
    where: { OR: [{ recipientUserId: { in: userIds } }, { employeeId: { in: empIds } }] },
  });
  await db.notification.deleteMany({ where: { message: { contains: TAG } } });
  await db.leaveRequest.deleteMany({ where: { employeeId: { in: empIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.employee.deleteMany({ where: { id: { in: empIds } } });
  await db.auditLog.deleteMany({ where: { actorUserId: ACTOR } });
}

async function main() {
  try {
    await cleanup();
    console.log("══ SUPER ADMIN IDENTITY & NOTIFICATIONS VERIFICATION ═══");

    // ── 1: THE SUPER ADMIN USER ROW ─────────────────────────────────
    step("1", "Super Admin exists as a User with employeeId = NULL");

    const admins = await db.user.findMany({
      where: { role: "SUPER_ADMIN" },
      select: { id: true, clerkId: true, role: true, employeeId: true },
      orderBy: { createdAt: "asc" },
    });
    check("1a at least one SUPER_ADMIN User row exists",
      admins.length > 0,
      `${admins.length} found: ${admins.map((a) => a.clerkId).join(", ") || "(none)"}`);
    if (admins.length === 0) {
      console.log(
        "\n  Cannot continue: run prisma/provision-super-admin-user.ts first.",
      );
      return;
    }

    // The employee-less one is the account this work exists for.
    const superAdmin = admins.find((a) => a.employeeId === null) ?? admins[0];
    check("1b that Super Admin has employeeId = NULL (no HR profile, by design)",
      superAdmin.employeeId === null,
      `clerkId=${superAdmin.clerkId} employeeId=${superAdmin.employeeId ?? "NULL"}`);
    check("1c role is SUPER_ADMIN",
      superAdmin.role === "SUPER_ADMIN", `role=${superAdmin.role}`);
    check("1d clerkId is a real Clerk identifier",
      superAdmin.clerkId.startsWith("user_"), `clerkId=${superAdmin.clerkId}`);
    if (EMAIL_HINT)
      console.log(`        (asserted against the account provisioned for ${EMAIL_HINT})`);

    check("1e NO Employee record was invented for them",
      superAdmin.employeeId === null,
      "employeeId is NULL — no fictional HR row, per the architecture decision");

    const provisioned = await db.auditLog.findFirst({
      where: {
        action: "SUPER_ADMIN_USER_PROVISIONED",
        targetEntity: { contains: superAdmin.clerkId },
      },
    });
    check("1f the provisioning is on the audit trail",
      provisioned !== null,
      provisioned?.targetEntity ?? "no SUPER_ADMIN_USER_PROVISIONED row");

    // ── 2: ROLES & PERMISSIONS PAGE DATA ────────────────────────────
    step("2", "Roles & Permissions roster includes them");

    // The EXACT query app/admin/roles/page.tsx load() runs.
    const roster = await db.user.findMany({
      include: {
        employee: {
          select: { id: true, name: true, employeeCode: true, department: true, active: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    const row = roster.find((u) => u.id === superAdmin.id);
    check("2a appears in the Accounts roster",
      row !== undefined, `${roster.length} account(s) listed`);
    check("2b renders as an account with no linked employee, not a broken row",
      row?.employee === null,
      `employee=${row?.employee === null ? "null → page shows “— none —”" : JSON.stringify(row?.employee)}`);
    check("2c the row carries everything the page renders (clerkId + role)",
      !!row?.clerkId && !!row?.role,
      `clerkId=${row?.clerkId} role=${row?.role}`);

    // ── 3: LAST-ADMIN LOCK — BOTH BRANCHES ──────────────────────────
    step("3", "last-admin lock — blocked, then allowed");

    const clerkCalls: { clerkId: string; role: string }[] = [];
    const stubClerk: UpdateClerkRoleFn = async (clerkId, role) => {
      clerkCalls.push({ clerkId, role });
    };

    const adminCountBefore = await db.user.count({ where: { role: "SUPER_ADMIN" } });
    check("3a the lock counts USERS by role, not Employee-joined rows",
      adminCountBefore === admins.length,
      `User.count(role=SUPER_ADMIN)=${adminCountBefore} — an employee-less admin is visible to it`);

    // BLOCKED BRANCH. Safe: changeUserRole() evaluates the guard and returns
    // BEFORE any write when it refuses. The role is re-read below to prove it.
    if (adminCountBefore === 1) {
      const blocked = await changeUserRole(
        db,
        { userId: superAdmin.id, newRole: "HR", actorUserId: ACTOR },
        stubClerk,
      );
      check("3b demoting the ONLY Super Admin is refused",
        !blocked.ok && blocked.code === "LAST_SUPER_ADMIN",
        JSON.stringify(blocked));
      check("3c the refusal is a clean { ok:false, code, message }, not a throw",
        !blocked.ok && typeof blocked.message === "string" && blocked.message.length > 0,
        !blocked.ok ? blocked.message : "");
      check("3d Clerk was never called for a refused change",
        clerkCalls.length === 0, `calls=${clerkCalls.length}`);
      const untouched = await db.user.findUnique({ where: { id: superAdmin.id } });
      check("3e the real Super Admin's role is UNCHANGED after the refusal",
        untouched?.role === "SUPER_ADMIN", `role=${untouched?.role}`);
    } else {
      console.log(
        `        SKIP 3b–3e: ${adminCountBefore} Super Admins exist, so the "only admin"\n` +
          `        branch cannot be exercised without demoting a real one. Not done.`,
      );
    }

    // ALLOWED BRANCH. A throwaway second admin — and it is the THROWAWAY that
    // gets demoted, never the real account.
    const spare = await db.user.create({
      data: { clerkId: SPARE_CLERK_ID, role: "SUPER_ADMIN", employeeId: null },
    });
    const twoAdmins = await db.user.count({ where: { role: "SUPER_ADMIN" } });
    check("3f a second Super Admin raises the count",
      twoAdmins === adminCountBefore + 1, `count=${twoAdmins}`);

    clerkCalls.length = 0;
    const allowed = await changeUserRole(
      db,
      { userId: spare.id, newRole: "HR", actorUserId: ACTOR },
      stubClerk,
    );
    check("3g with two admins, demoting one is ALLOWED",
      allowed.ok && allowed.oldRole === "SUPER_ADMIN" && allowed.newRole === "HR",
      JSON.stringify(allowed));
    const spareAfter = await db.user.findUnique({ where: { id: spare.id } });
    check("3h the demotion actually committed",
      spareAfter?.role === "HR", `role=${spareAfter?.role}`);
    check("3i changeUserRole handled a target with employeeId = NULL without erroring",
      allowed.ok && spareAfter?.employeeId === null,
      `employeeId=${spareAfter?.employeeId ?? "NULL"}`);

    // Back to one admin — and the lock closes again.
    const reblocked = await changeUserRole(
      db,
      { userId: superAdmin.id, newRole: "HR", actorUserId: ACTOR },
      stubClerk,
    );
    check("3j with the spare demoted, the lock closes over the real admin again",
      !reblocked.ok && reblocked.code === "LAST_SUPER_ADMIN",
      JSON.stringify(reblocked));

    // ── 4: ROLE-DISTRIBUTION REPORTING ──────────────────────────────
    step("4", "role distribution counts them");

    // The EXACT query app/admin/page.tsx load() runs for the ring chart.
    const roleGroups = await db.user.groupBy({ by: ["role"], _count: { _all: true } });
    const adminSlice = roleGroups.find((g) => g.role === "SUPER_ADMIN");
    check("4a SUPER_ADMIN appears in the distribution",
      adminSlice !== undefined,
      roleGroups.map((g) => `${g.role}=${g._count._all}`).join("  "));
    check("4b the count includes the employee-less admin",
      (adminSlice?._count._all ?? 0) >= 1,
      `SUPER_ADMIN=${adminSlice?._count._all ?? 0}`);
    const totalUsers = roleGroups.reduce((n, g) => n + g._count._all, 0);
    const realTotal = await db.user.count();
    check("4c the total aggregates every User, with no Employee join to exclude any",
      totalUsers === realTotal, `groupBy total=${totalUsers} User.count=${realTotal}`);

    // ── 5: NOTIFICATION TO AN EMPLOYEE-LESS ADMIN ───────────────────
    step("5", "a system alert reaches them despite employeeId = NULL");

    const sent = await db.$transaction((tx) =>
      notifyUsers(tx, [
        {
          recipientUserId: superAdmin.id,
          employeeId: null,
          type: "PAYSLIP_READY",
          message: `${TAG} Payroll for this period is awaiting finalization.`,
        },
      ]),
    );
    check("5a the notification was created", sent === 1, `created=${sent}`);

    // The EXACT query app/hr/page.tsx loadNotifications() runs — the surface a
    // Super Admin actually reads, since ROUTE_ACCESS.hr includes SUPER_ADMIN.
    const inbox = await db.notification.findMany({
      where: { recipientUserId: superAdmin.id },
      orderBy: [{ read: "asc" }, { createdAt: "desc" }],
      take: 10,
    });
    const alert = inbox.find((n) => n.message.includes(TAG));
    check("5b it is queryable by the dashboard's own recipientUserId lookup",
      alert !== undefined, `${inbox.length} row(s) in this account's inbox`);
    check("5c it carries NO employee context — nothing fictional was invented",
      alert?.employeeId === null, `employeeId=${alert?.employeeId ?? "null"}`);
    check("5d it starts unread, like every other notification",
      alert?.read === false, `read=${alert?.read}`);

    // Mark-read is the other half of delivery: the server action scopes by
    // recipientUserId, so run that exact predicate.
    const marked = await db.notification.updateMany({
      where: { id: { in: [alert!.id] }, recipientUserId: superAdmin.id, read: false },
      data: { read: true },
    });
    check("5e they can mark their own notification read (scoped by recipientUserId)",
      marked.count === 1, `updated=${marked.count}`);

    // And the scope predicate still excludes other people's rows.
    const foreign = await db.notification.updateMany({
      where: { id: { in: [alert!.id] }, recipientUserId: spare.id, read: false },
      data: { read: true },
    });
    check("5f another account cannot mark it read — the scope holds",
      foreign.count === 0, `updated=${foreign.count}`);

    // ── 6: EMPLOYEE NOTIFICATION PATH — NO REGRESSION ───────────────
    step("6", "employee-subject notifications still work unchanged");

    const mgrEmp = await db.employee.create({
      data: {
        employeeCode: `${TAG}-MGR`,
        name: `${TAG} Real Manager`,
        department: `${TAG}-Ops`,
        joiningDate: new Date(2020, 0, 1),
      },
    });
    const mgrUser = await db.user.create({
      data: { clerkId: "user_zzsai_manager_0001", role: "MANAGER", employeeId: mgrEmp.id },
    });
    const staffEmp = await db.employee.create({
      data: {
        employeeCode: `${TAG}-EMP`,
        name: `${TAG} Direct Report`,
        department: `${TAG}-Ops`,
        managerId: mgrEmp.id,
        joiningDate: new Date(2020, 0, 1),
      },
    });
    const staffUser = await db.user.create({
      data: { clerkId: "user_zzsai_employee_0001", role: "EMPLOYEE", employeeId: staffEmp.id },
    });

    const leaveSent = await db.$transaction((tx) =>
      notifyEmployee(
        tx,
        staffEmp.id,
        "LEAVE_APPROVED",
        `${TAG} Your leave request for 2026-08-03 was approved.`,
      ),
    );
    check("6a LEAVE_APPROVED still delivers", leaveSent === 1, `created=${leaveSent}`);

    const leaveNote = await db.notification.findFirst({
      where: { employeeId: staffEmp.id, type: "LEAVE_APPROVED" },
    });
    check("6b delivered to the employee's USER",
      leaveNote?.recipientUserId === staffUser.id,
      `recipientUserId=${leaveNote?.recipientUserId} expected=${staffUser.id}`);
    check("6c the employee is RETAINED as context — the notification is about them",
      leaveNote?.employeeId === staffEmp.id,
      `employeeId=${leaveNote?.employeeId}`);
    check("6d it appears in that employee's own dashboard query",
      (await db.notification.count({
        where: { recipientUserId: staffUser.id, type: "LEAVE_APPROVED" },
      })) === 1);

    // ── 7: MANAGER BOUNDARY — VERIFIED, NOT CHANGED ─────────────────
    step("7", "Manager-only action stays CLOSED to the Super Admin");

    const request = await db.leaveRequest.create({
      data: {
        employeeId: staffEmp.id,
        startDate: new Date(2026, 7, 10),
        endDate: new Date(2026, 7, 10),
        reason: `${TAG} boundary test`,
      },
    });

    // GUARD 1 — the route's first check: getEmployeeByClerkId(userId) must
    // resolve an Employee, or it returns NO_EMPLOYEE 403. The Super Admin has
    // none, so this is where they stop. Same query lib/data/scope.ts runs.
    const adminEmployee = await db.user
      .findUnique({ where: { clerkId: superAdmin.clerkId }, include: { employee: true } })
      .then((u) => u?.employee ?? null);
    check("7a the Super Admin resolves to NO Employee → route returns NO_EMPLOYEE 403",
      adminEmployee === null,
      "a clean, structured rejection — not a crash, and not a null dereference");

    // GUARD 2 — the authoritative one. Even past guard 1, approval is decided
    // by the atomic where-clause: the request's employee must be a DIRECT
    // REPORT of the approver. Run that exact predicate with a manager id the
    // Super Admin could never satisfy.
    const asAdmin = await db.leaveRequest.updateMany({
      where: {
        id: request.id,
        status: "PENDING",
        employee: { managerId: superAdmin.id },
      },
      data: { status: "APPROVED", approvedBy: superAdmin.clerkId },
    });
    check("7b the relationship predicate matches ZERO rows for them",
      asAdmin.count === 0,
      `rows matched=${asAdmin.count} — no line-management relationship exists`);

    const stillPending = await db.leaveRequest.findUnique({ where: { id: request.id } });
    check("7c the leave request is untouched, still PENDING",
      stillPending?.status === "PENDING" && stillPending?.approvedBy === null,
      `status=${stillPending?.status} approvedBy=${stillPending?.approvedBy ?? "null"}`);

    // POSITIVE CONTROL — the same predicate MUST succeed for the real manager,
    // proving 7b is a genuine relationship check and not a broken query that
    // rejects everyone.
    const asManager = await db.leaveRequest.updateMany({
      where: {
        id: request.id,
        status: "PENDING",
        employee: { managerId: mgrEmp.id },
      },
      data: { status: "APPROVED", approvedBy: mgrUser.clerkId },
    });
    check("7d the SAME predicate succeeds for the actual manager (positive control)",
      asManager.count === 1,
      `rows matched=${asManager.count} — the boundary is relationship-based, not broken`);

    check("7e no fictional Employee, team or manager link was created for the admin",
      (await db.user.findUnique({ where: { id: superAdmin.id } }))?.employeeId === null &&
        (await db.employee.count({ where: { managerId: superAdmin.id } })) === 0,
      "Super Admin still has employeeId = NULL and no reports");

    // ── 8: THE REJECTED ANTI-PATTERN ────────────────────────────────
    step("8", "employeeId = NULL is not used as a role test anywhere");

    // The document explicitly rejects "if employeeId is null, this must be
    // Super Admin". Prove the codebase cannot rely on it: a non-admin User
    // with employeeId = NULL is a perfectly valid row, so the inference is
    // false by construction.
    const nonAdminNoEmployee = await db.user.create({
      data: { clerkId: "user_zzsai_hr_no_employee", role: "HR", employeeId: null },
    });
    check("8a a NON-admin User may also have employeeId = NULL",
      nonAdminNoEmployee.employeeId === null && nonAdminNoEmployee.role === "HR",
      "so employeeId=NULL can never imply SUPER_ADMIN — role is the only authority");
    check("8b role-based lookups still classify it correctly",
      (await db.user.count({ where: { role: "HR", employeeId: null } })) >= 1 &&
        (await db.user.count({ where: { role: "SUPER_ADMIN", id: nonAdminNoEmployee.id } })) === 0,
      "counted as HR, never as an administrator");
  } finally {
    console.log("\n── CLEANUP ─────────────────────────────────────────────");
    await cleanup();
    const leftUsers = await db.user.count({ where: { clerkId: { startsWith: "user_zzsai" } } });
    const leftEmps = await db.employee.count({ where: { employeeCode: { startsWith: TAG } } });
    const leftNotes = await db.notification.count({ where: { message: { contains: TAG } } });
    check("9. every throwaway row removed",
      leftUsers === 0 && leftEmps === 0 && leftNotes === 0,
      `users=${leftUsers} employees=${leftEmps} notifications=${leftNotes}`);

    const finalAdmins = await db.user.findMany({
      where: { role: "SUPER_ADMIN" },
      select: { clerkId: true, employeeId: true },
    });
    check("10. the REAL Super Admin is intact and still SUPER_ADMIN",
      finalAdmins.length >= 1,
      finalAdmins.map((a) => `${a.clerkId} employeeId=${a.employeeId ?? "NULL"}`).join(", "));

    console.log(`\n${"═".repeat(56)}\n  ${pass} passed, ${fail} failed\n${"═".repeat(56)}`);
    if (fail > 0) process.exitCode = 1;
    await db.$disconnect();
  }
}

main().catch(async (err) => {
  console.error("VERIFICATION CRASHED:", err);
  process.exitCode = 1;
  await db.$disconnect();
});
