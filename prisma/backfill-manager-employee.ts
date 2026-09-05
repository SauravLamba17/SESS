/**
 * ONE-SHOT BACKFILL: give the Manager account its HR profile.
 *
 * WHY THIS EXISTS
 * Phase 6's self-heal gave saurav@simplenbilling.co.in a User row the moment it
 * proved the account was legitimate (Clerk publicMetadata.role = MANAGER), and
 * correctly left employeeId NULL because no Employee owned that address. That
 * is the right answer for an administrator with no HR profile — but the Manager
 * IS real tracked staff, so the missing half is a DATA gap, not a code one.
 * This script closes it.
 *
 * WHY NOT THE HR ONBOARDING UI
 * app/api/hr/employee/route.ts is the normal path, but its `sendInvitation`
 * branch would offer to email a Clerk invitation to an address that already
 * owns a working login. sendEmployeeInvitation() would refuse it
 * (code ALREADY_LINKED — the employee already has an account), so nothing would
 * actually be sent, but the safest way to guarantee that is to never enter the
 * branch. This script therefore calls the SHARED onboarding function directly
 * and never touches the invitation module at all.
 *
 * WHAT IT DOES
 *   1. onboardEmployee() — the SAME lib/employees/onboard.ts function both HR
 *      onboarding and Phase 8 hire-conversion call. No second implementation of
 *      employeeCode uniqueness, email validation or the EMPLOYEE_ONBOARDED
 *      audit row. It creates an Employee and an audit row and NOTHING else; the
 *      invitation is deliberately not part of it (see that file's header).
 *   2. attaches the new Employee to the EXISTING User row, conditionally and
 *      audited, in one transaction.
 *
 * WHY STEP 2 IS NOT linkClerkUserToEmployee()
 * That function's job is to CREATE a User row for a Clerk id that has none, and
 * its first act is an idempotency check that returns ALREADY_LINKED_CLERK when
 * one exists. The Manager already HAS a User row — Phase 6 created it — so that
 * function structurally cannot do this job and would correctly refuse. The
 * write below is the "equally careful, audited update" instead:
 *
 *   - CONDITIONAL: updateMany(where: { clerkId, employeeId: null }) — the same
 *     atomic where-clause pattern the leave-approval route uses. If anything
 *     attached an Employee in the meantime the count is 0, the transaction
 *     rolls back and nothing is overwritten. A pre-read could go stale between
 *     the check and the write; this cannot.
 *   - User.employeeId is @unique, so the database itself refuses to point two
 *     accounts at one Employee (P2002) regardless of what this script asks.
 *   - AUDITED in the SAME transaction, reusing the existing
 *     EMPLOYEE_ACCOUNT_LINKED action and targetEntity shape (including the
 *     `source=` suffix Phase 6 added) so the trail stays queryable by one
 *     action name rather than growing a private vocabulary.
 *
 * ─── SAFETY ──────────────────────────────────────────────────────────────
 * DRY RUN BY DEFAULT — prints exactly what it would do and writes nothing.
 * Pass --apply to commit. Idempotent: re-running after a successful apply
 * reports the existing rows and exits 0 without a second write. It never
 * deletes anything, never updates the Employee table after creation, never
 * changes a role, and never calls Clerk — no invitation can be sent from here
 * because the invitation module is not imported.
 *
 * Cache note: the HR route follows onboardEmployee() with
 * onEmployeeRosterChanged() (revalidateTag). That is server-only Next.js API
 * and cannot run — nor does it need to — from a script: the Next data cache
 * does not survive the process, so the next server start reads fresh.
 *
 * Run:
 *   node --env-file=.env prisma/backfill-manager-employee.ts
 *   node --env-file=.env prisma/backfill-manager-employee.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { onboardEmployee } from "../lib/employees/onboard.ts";
import { parseDateOnly } from "../lib/period.ts";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const MANAGER_CLERK_ID = "user_3Hp92w6Hi21i1ZKn65BajiZzBxq";
const MANAGER_EMAIL = "saurav@simplenbilling.co.in";
const EMPLOYEE_CODE = "EMP-0003";
const NAME = "Manager";
/** Employee-1's exact department value, read live in step 0 and asserted. */
const EXPECTED_DEPARTMENT_SOURCE = "EMP-0002";
/** Today, as a local-midnight Date — the same shape parseDateOnly gives the HR route. */
const JOINING_DATE = parseDateOnly("2026-09-04")!;
/**
 * The Super Admin authorised this backfill. Naming them (rather than the
 * Manager) keeps the audit trail honest about who directed the change; the
 * script name in targetEntity says how it was carried out.
 */
const ACTOR = "user_3GgiUDKaahfeNlMvfRfqhD6bQLS";
const SOURCE = "backfill-manager-employee";

function line(s = "") {
  console.log(s);
}

async function main() {
  line(
    `\n${"═".repeat(74)}\n  BACKFILL MANAGER EMPLOYEE   ${APPLY ? "*** APPLY (writing) ***" : "dry run (no writes)"}\n${"═".repeat(74)}\n`,
  );

  // ── 0. Read the department from Employee-1, do not hardcode it ────────
  const source = await db.employee.findUnique({
    where: { employeeCode: EXPECTED_DEPARTMENT_SOURCE },
    select: { employeeCode: true, name: true, department: true },
  });
  if (!source) {
    console.error(`FAILED: no employee ${EXPECTED_DEPARTMENT_SOURCE} to take the department from.`);
    process.exitCode = 1;
    return;
  }
  const department = source.department;
  line(`Department source : ${source.employeeCode} (${source.name})`);
  line(`Department value  : ${JSON.stringify(department)}  ← used verbatim`);

  // ── 1. The User row that needs the profile ────────────────────────────
  const user = await db.user.findUnique({
    where: { clerkId: MANAGER_CLERK_ID },
    select: { id: true, clerkId: true, role: true, employeeId: true },
  });
  if (!user) {
    console.error(
      `FAILED: no User row for ${MANAGER_CLERK_ID}. Phase 6's self-heal creates it on\n` +
        `        first authenticated request — nothing to attach to yet.`,
    );
    process.exitCode = 1;
    return;
  }
  line(`\nUser row          : ${user.id}  role=${user.role}  employeeId=${user.employeeId ?? "NULL"}`);

  if (user.employeeId) {
    const cur = await db.employee.findUnique({ where: { id: user.employeeId } });
    line(
      `\nAlready attached — nothing to do.\n` +
        `  Employee ${cur?.employeeCode} "${cur?.name}" dept=${JSON.stringify(cur?.department)}`,
    );
    return;
  }

  // ── 2. Plan the Employee ──────────────────────────────────────────────
  const existingByCode = await db.employee.findUnique({ where: { employeeCode: EMPLOYEE_CODE } });
  const existingByEmail = await db.employee.findUnique({ where: { email: MANAGER_EMAIL } });
  line(`\nEmployee ${EMPLOYEE_CODE}    : ${existingByCode ? "ALREADY EXISTS" : "free"}`);
  line(`Employee by email : ${existingByEmail ? `ALREADY EXISTS (${existingByEmail.employeeCode})` : "none"}`);
  if (existingByCode || existingByEmail) {
    console.error(
      `\nFAILED: an Employee already occupies that code or address. Refusing to guess\n` +
        `        which record the Manager should be — resolve it by hand.`,
    );
    process.exitCode = 1;
    return;
  }

  line(
    `\nWould CREATE Employee {\n` +
      `    employeeCode : ${EMPLOYEE_CODE}\n` +
      `    name         : ${NAME}\n` +
      `    department   : ${JSON.stringify(department)}\n` +
      `    joiningDate  : ${JOINING_DATE.toDateString()}  (local midnight)\n` +
      `    email        : ${MANAGER_EMAIL}\n` +
      `    designation  : null   (not specified — nothing invented)\n` +
      `    managerId    : null   (not specified — nothing invented)\n` +
      `  }`,
  );
  line(`Would CREATE AuditLog EMPLOYEE_ONBOARDED`);
  line(`Would UPDATE User ${user.id} employeeId: NULL → <new employee>`);
  line(`Would CREATE AuditLog EMPLOYEE_ACCOUNT_LINKED`);
  line(`\nNo invitation is sent: this script does not import lib/employees/invite.ts.`);

  if (!APPLY) {
    line(`\nDry run only — nothing was written. Re-run with --apply to commit.`);
    return;
  }

  // ── 3. Create via the SHARED onboarding function ──────────────────────
  const result = await db.$transaction((tx) =>
    onboardEmployee(
      tx,
      {
        employeeCode: EMPLOYEE_CODE,
        name: NAME,
        department,
        designation: null,
        managerId: null,
        machineId: null,
        joiningDate: JOINING_DATE,
        email: MANAGER_EMAIL,
      },
      ACTOR,
    ),
  );
  if (!result.ok) {
    console.error(`\nFAILED to onboard: ${result.code} — ${result.message}`);
    process.exitCode = 1;
    return;
  }
  const empId = result.employee.id;
  line(`\nCREATED Employee ${empId}  ${result.employee.employeeCode}  "${result.employee.name}"`);

  // ── 4. Attach it to the existing User row — conditional + audited ─────
  const attach = await db.$transaction(async (tx) => {
    // Conditional on employeeId still being NULL: if anything attached one
    // between the read above and now, this matches 0 rows and the whole
    // transaction (audit row included) rolls back.
    const upd = await tx.user.updateMany({
      where: { clerkId: MANAGER_CLERK_ID, employeeId: null },
      data: { employeeId: empId },
    });
    if (upd.count !== 1) throw new Error(`expected to update exactly 1 User row, updated ${upd.count}`);
    await tx.auditLog.create({
      data: {
        actorUserId: ACTOR,
        action: "EMPLOYEE_ACCOUNT_LINKED",
        targetEntity: `employee=${empId} clerkId=${MANAGER_CLERK_ID} role=${user.role} source=${SOURCE}`,
      },
    });
    return upd.count;
  });
  line(`ATTACHED to User ${user.id}  (rows updated: ${attach})`);

  // ── 5. Read back and verify ───────────────────────────────────────────
  const check = await db.user.findUnique({
    where: { clerkId: MANAGER_CLERK_ID },
    include: { employee: true },
  });
  const e = check?.employee;
  const ok =
    check?.employeeId === empId &&
    check?.role === "MANAGER" &&
    e?.employeeCode === EMPLOYEE_CODE &&
    e?.name === NAME &&
    e?.department === department &&
    e?.joiningDate.getTime() === JOINING_DATE.getTime() &&
    e?.email === MANAGER_EMAIL &&
    e?.active === true &&
    e?.pendingInvitationId === null;

  line(`\nVerification (read back from the database):`);
  line(`  User.employeeId        ${check?.employeeId}  ${check?.employeeId === empId ? "OK" : "MISMATCH"}`);
  line(`  User.role              ${check?.role}  ${check?.role === "MANAGER" ? "OK" : "MISMATCH"}`);
  line(`  Employee.employeeCode  ${e?.employeeCode}  ${e?.employeeCode === EMPLOYEE_CODE ? "OK" : "MISMATCH"}`);
  line(`  Employee.name          ${e?.name}  ${e?.name === NAME ? "OK" : "MISMATCH"}`);
  line(`  Employee.department    ${JSON.stringify(e?.department)}  ${e?.department === department ? "OK" : "MISMATCH"}`);
  line(`  Employee.joiningDate   ${e?.joiningDate.toDateString()}  ${e?.joiningDate.getTime() === JOINING_DATE.getTime() ? "OK" : "MISMATCH"}`);
  line(`  Employee.email         ${e?.email}  ${e?.email === MANAGER_EMAIL ? "OK" : "MISMATCH"}`);
  line(`  Employee.pendingInvitationId  ${e?.pendingInvitationId ?? "NULL"}  ${e?.pendingInvitationId === null ? "OK — no invitation was ever created" : "UNEXPECTED"}`);

  if (!ok) {
    console.error(`\nVERIFICATION FAILED — the rows do not match what was requested.`);
    process.exitCode = 1;
    return;
  }
  line(`\nDone. Audit: EMPLOYEE_ONBOARDED + EMPLOYEE_ACCOUNT_LINKED (source=${SOURCE})`);
}

main()
  .catch((err) => {
    console.error("BACKFILL FAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
