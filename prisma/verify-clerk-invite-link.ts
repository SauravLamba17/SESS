/**
 * Verification: Clerk invitation sending + webhook account-linking.
 *
 * Runs against the REAL database with the REAL logic from
 * lib/employees/onboard.ts and lib/employees/invite.ts. The ONLY things stubbed
 * are the two Clerk Backend API calls (createInvitation, findClerkUserByEmail)
 * — no real email can be sent from this environment, and the invite logic
 * deliberately takes both as parameters so the stubs exercise everything else
 * for real: employee lookup, email validation, pendingInvitationId persistence,
 * audit rows, and the full webhook-side linking path.
 *
 * Steps 2c/2d cover the already-registered-address gap: an email that already
 * owns a Clerk account can never sign up again, so it can never fire
 * user.created — inviting it produces a permanently pending invitation and no
 * User row. Expected behaviour is to link immediately and send nothing (2c),
 * and to refuse rather than guess if the Clerk lookup is down (2d).
 *
 * The webhook HTTP layer (svix signature verification) is Clerk's own
 * verifyWebhook and is not re-tested here; what IS tested is everything the
 * route does after verification, via the same linkClerkUserToEmployee() the
 * route calls.
 *
 * Creates its own throwaway data and deletes everything, pass or fail.
 *
 * Run:  node --env-file=.env prisma/verify-clerk-invite-link.ts
 */
import { PrismaClient } from "@prisma/client";
import { onboardEmployee } from "../lib/employees/onboard.ts";
import {
  sendEmployeeInvitation,
  linkClerkUserToEmployee,
  type CreateInvitationFn,
  type FindClerkUserByEmailFn,
} from "../lib/employees/invite.ts";

const db = new PrismaClient();

const TAG = "ZZ-INV";
const ACTOR = "test-inv-actor";
const EMAIL = "zz-inv-employee@example.invalid";
const CLERK_ID = "user_zzinvtest_0001";
/** Second employee, used for the "address already has a Clerk account" case. */
const EMAIL2 = "zz-inv-existing@example.invalid";
const CLERK_ID2 = "user_zzinvtest_0002";

/** No Clerk account owns this address — the ordinary invitation path. */
const stubNoClerkUser: FindClerkUserByEmailFn = async () => null;

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
}
function step(n: string, title: string) {
  console.log(`\n── ${n}: ${title} ${"─".repeat(Math.max(0, 42 - title.length))}`);
}

async function cleanup() {
  const emps = await db.employee.findMany({
    where: { OR: [{ name: { startsWith: TAG } }, { email: EMAIL }, { email: EMAIL2 }] },
    select: { id: true },
  });
  const ids = emps.map((e) => e.id);
  await db.user.deleteMany({
    where: { OR: [{ clerkId: CLERK_ID }, { clerkId: CLERK_ID2 }, { employeeId: { in: ids } }] },
  });
  await db.onboardingTask.deleteMany({ where: { employeeId: { in: ids } } });
  await db.employee.deleteMany({ where: { id: { in: ids } } });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: ACTOR },
        { actorUserId: CLERK_ID },
        { actorUserId: CLERK_ID2 },
        ...ids.map((id) => ({ targetEntity: { contains: id } })),
      ],
    },
  });
}

async function main() {
  await cleanup();

  // ── 1: onboarding stores the email ─────────────────────────────
  step("1", "onboardEmployee stores a lowercased email");
  const onboarded = await db.$transaction((tx) =>
    onboardEmployee(
      tx,
      {
        employeeCode: `${TAG}-0001`,
        name: `${TAG} Invite Target`,
        department: "Testing",
        joiningDate: new Date(2026, 6, 1),
        email: "  ZZ-INV-Employee@Example.INVALID ", // messy on purpose
      },
      ACTOR,
    ),
  );
  check("onboard succeeded", onboarded.ok, JSON.stringify(onboarded));
  if (!onboarded.ok) throw new Error("cannot continue");
  const empId = onboarded.employee.id;
  const empRow = await db.employee.findUnique({ where: { id: empId } });
  check("email normalized + stored", empRow?.email === EMAIL, `got ${empRow?.email}`);

  step("1b", "duplicate email is refused");
  const dupe = await db.$transaction((tx) =>
    onboardEmployee(
      tx,
      {
        employeeCode: `${TAG}-0002`,
        name: `${TAG} Duplicate`,
        department: "Testing",
        joiningDate: new Date(2026, 6, 1),
        email: EMAIL,
      },
      ACTOR,
    ),
  );
  check("DUPLICATE_EMAIL returned", !dupe.ok && dupe.code === "DUPLICATE_EMAIL", JSON.stringify(dupe));

  // ── 2: invitation sending (Clerk API stubbed) ──────────────────
  step("2", "sendEmployeeInvitation — stubbed Clerk call");
  const calls: unknown[] = [];
  const stubOk: CreateInvitationFn = async (params) => {
    calls.push(params);
    return { id: "inv_zzstub_123" };
  };
  const sent = await sendEmployeeInvitation(
    db,
    { employeeId: empId, role: "MANAGER", actorUserId: ACTOR },
    stubOk,
    stubNoClerkUser,
  );
  check("invitation reported sent", sent.ok, JSON.stringify(sent));
  check("reported as an invitation, not an immediate link", sent.ok && sent.linked === false);
  check(
    "Clerk called with email + role metadata",
    calls.length === 1 &&
      (calls[0] as { emailAddress: string; publicMetadata: { role: string } }).emailAddress === EMAIL &&
      (calls[0] as { publicMetadata: { role: string } }).publicMetadata.role === "MANAGER",
    JSON.stringify(calls),
  );
  const afterSend = await db.employee.findUnique({ where: { id: empId } });
  check("pendingInvitationId stored", afterSend?.pendingInvitationId === "inv_zzstub_123");
  const sentAudit = await db.auditLog.findFirst({
    where: { action: "EMPLOYEE_INVITATION_SENT", targetEntity: { contains: empId } },
  });
  check("EMPLOYEE_INVITATION_SENT audit row", sentAudit !== null);

  step("2b", "Clerk failure is graceful — employee row survives");
  const stubFail: CreateInvitationFn = async () => {
    throw { errors: [{ message: "duplicate_record", longMessage: "An invitation already exists." }] };
  };
  // Temporarily clear the pending id so we can see it is NOT overwritten on failure.
  const failRes = await sendEmployeeInvitation(
    db,
    { employeeId: empId, role: "EMPLOYEE", actorUserId: ACTOR },
    stubFail,
    stubNoClerkUser,
  );
  check(
    "failure surfaced as CLERK_ERROR with Clerk's message",
    !failRes.ok && failRes.code === "CLERK_ERROR" && failRes.message.includes("already exists"),
    JSON.stringify(failRes),
  );
  const afterFail = await db.employee.findUnique({ where: { id: empId } });
  check("employee record intact after failure", afterFail !== null && afterFail.email === EMAIL);


  // ── 2c: address ALREADY has a Clerk account ────────────────────
  // The gap this whole change closes. An existing account can never sign up
  // again, so it can never fire user.created — an invitation here would sit
  // pending forever. Expected: linked on the spot, and NO invitation created.
  step("2c", "existing Clerk account → linked now, NO invitation");
  const onboarded2 = await db.$transaction((tx) =>
    onboardEmployee(
      tx,
      {
        employeeCode: `${TAG}-0003`,
        name: `${TAG} Already Has Account`,
        department: "Testing",
        joiningDate: new Date(2026, 6, 1),
        email: EMAIL2,
      },
      ACTOR,
    ),
  );
  check("second employee onboarded", onboarded2.ok, JSON.stringify(onboarded2));
  if (!onboarded2.ok) throw new Error("cannot continue");
  const empId2 = onboarded2.employee.id;

  const inviteCalls2: unknown[] = [];
  const stubShouldNotRun: CreateInvitationFn = async (params) => {
    inviteCalls2.push(params);
    return { id: "inv_zzstub_SHOULD_NOT_EXIST" };
  };
  const stubHasClerkUser: FindClerkUserByEmailFn = async () => ({ id: CLERK_ID2 });

  const existing = await sendEmployeeInvitation(
    db,
    { employeeId: empId2, role: "HR", actorUserId: ACTOR },
    stubShouldNotRun,
    stubHasClerkUser,
  );
  check("reported ok + linked", existing.ok && existing.linked === true, JSON.stringify(existing));
  check("NO invitation was created", inviteCalls2.length === 0, JSON.stringify(inviteCalls2));
  check(
    "HR-facing message says the account already existed",
    existing.ok && /already had a SESS account/i.test(existing.message),
    existing.ok ? existing.message : "",
  );
  const userRow2 = await db.user.findUnique({ where: { clerkId: CLERK_ID2 } });
  check(
    "User row created with the requested role + employee",
    userRow2?.role === "HR" && userRow2?.employeeId === empId2,
    JSON.stringify(userRow2),
  );
  const emp2After = await db.employee.findUnique({ where: { id: empId2 } });
  check("no pendingInvitationId left behind", emp2After?.pendingInvitationId === null);
  const skipAudit = await db.auditLog.findFirst({
    where: {
      action: "EMPLOYEE_INVITATION_SKIPPED_EXISTING_ACCOUNT",
      targetEntity: { contains: empId2 },
    },
  });
  check("EMPLOYEE_INVITATION_SKIPPED_EXISTING_ACCOUNT audit row", skipAudit !== null);
  const linkAudit2 = await db.auditLog.findFirst({
    where: { action: "EMPLOYEE_ACCOUNT_LINKED", targetEntity: { contains: empId2 } },
  });
  check("EMPLOYEE_ACCOUNT_LINKED audit row", linkAudit2 !== null);
  const wrongAudit = await db.auditLog.findFirst({
    where: { action: "EMPLOYEE_INVITATION_SENT", targetEntity: { contains: empId2 } },
  });
  check("no EMPLOYEE_INVITATION_SENT audit row", wrongAudit === null);

  step("2d", "Clerk lookup outage fails CLOSED — no doomed invitation");
  const inviteCalls3: unknown[] = [];
  const lookupBroken: FindClerkUserByEmailFn = async () => {
    throw { errors: [{ longMessage: "Clerk is unreachable." }] };
  };
  const outage = await sendEmployeeInvitation(
    db,
    { employeeId: empId, role: "EMPLOYEE", actorUserId: ACTOR },
    async (p) => {
      inviteCalls3.push(p);
      return { id: "inv_zzstub_outage" };
    },
    lookupBroken,
  );
  check(
    "surfaced as CLERK_ERROR",
    !outage.ok && outage.code === "CLERK_ERROR",
    JSON.stringify(outage),
  );
  check("no invitation created during the outage", inviteCalls3.length === 0);

  // ── 3: webhook linking — matching email ────────────────────────
  step("3", "user.created with MATCHING email links a User row");
  const linked = await linkClerkUserToEmployee(db, {
    clerkId: CLERK_ID,
    email: EMAIL.toUpperCase(), // webhook emails may differ in case
    role: "MANAGER",
  });
  check("linked", linked.linked === true, JSON.stringify(linked));
  const userRow = await db.user.findUnique({ where: { clerkId: CLERK_ID } });
  check(
    "User row: clerkId + role + employeeId all correct",
    userRow?.role === "MANAGER" && userRow?.employeeId === empId,
    JSON.stringify(userRow),
  );
  const afterLink = await db.employee.findUnique({ where: { id: empId } });
  check("pendingInvitationId cleared on link", afterLink?.pendingInvitationId === null);
  const linkAudit = await db.auditLog.findFirst({
    where: { action: "EMPLOYEE_ACCOUNT_LINKED", targetEntity: { contains: empId } },
  });
  check("EMPLOYEE_ACCOUNT_LINKED audit row", linkAudit !== null);

  step("3b", "duplicate delivery (same clerkId) is an idempotent no-op");
  const again = await linkClerkUserToEmployee(db, { clerkId: CLERK_ID, email: EMAIL, role: "HR" });
  check("second delivery not linked, no crash", again.linked === false, JSON.stringify(again));
  const stillOne = await db.user.count({ where: { clerkId: CLERK_ID } });
  check("still exactly one User row", stillOne === 1);
  const roleUnchanged = await db.user.findUnique({ where: { clerkId: CLERK_ID } });
  check("role not overwritten by retry", roleUnchanged?.role === "MANAGER");

  // ── 4: webhook linking — NON-matching email ────────────────────
  step("4", "user.created with NON-matching email is a calm no-op");
  const usersBefore = await db.user.count();
  const noMatch = await linkClerkUserToEmployee(db, {
    clerkId: "user_zzinvtest_9999",
    email: "total-stranger@example.invalid",
    role: "EMPLOYEE",
  });
  check("not linked, reason given", noMatch.linked === false && noMatch.reason.length > 0, JSON.stringify(noMatch));
  const usersAfter = await db.user.count();
  check("no User row created for the stranger", usersAfter === usersBefore);

  console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("VERIFY SCRIPT CRASHED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await db.$disconnect();
    console.log("cleanup complete");
  });
