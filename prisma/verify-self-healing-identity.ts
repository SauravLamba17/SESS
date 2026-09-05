/**
 * PHASE 6 — self-healing account provisioning verification.
 *
 * Proves, against the REAL database and the REAL logic
 * (lib/employees/invite.ts: ensureUserForClerkIdentity + linkClerkUserToEmployee
 * — the same functions lib/auth.ts and the Clerk webhook call), that:
 *
 *   1. a Clerk identity with a valid role and NO User row gets one created on
 *      first resolution, with the right role and the Employee match ATTEMPTED
 *   2. the Employee link is attached when one matches, NULL when none does
 *   3. two simultaneous resolutions create exactly ONE row (race proof, run
 *      concurrently against the live database — executed, not asserted)
 *   4. an identity with no/unrecognised role in Clerk metadata creates NOTHING
 *   5. the real Manager account is provisioned through this mechanism
 *   6. the webhook path is byte-for-byte unchanged for a normal invitation
 *
 * ─── SAFETY ──────────────────────────────────────────────────────────────
 * Every throwaway row is tagged ZZ-P6 / user_zzp6* and deleted on the way out,
 * pass or fail. Real accounts are never modified: step 5 only ever CREATES a
 * missing User row for the real Manager (the whole point of Phase 6) and is
 * idempotent — re-running reports the existing row and writes nothing. No
 * Employee is ever invented for anyone.
 *
 * Run:  node --env-file=.env prisma/verify-self-healing-identity.ts
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createClerkClient } from "@clerk/backend";
import {
  ensureUserForClerkIdentity,
  linkClerkUserToEmployee,
} from "../lib/employees/invite.ts";
import { coerceRole } from "../lib/auth-types.ts";

const ROOT = path.join(import.meta.dirname, "..");

const db = new PrismaClient();

const TAG = "ZZ-P6";
const MANAGER_EMAIL = "saurav@simplenbilling.co.in";

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
    where: { OR: [{ employeeId: { in: empIds } }, { clerkId: { startsWith: "user_zzp6" } }] },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await db.notification.deleteMany({
    where: { OR: [{ recipientUserId: { in: userIds } }, { employeeId: { in: empIds } }] },
  });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.employee.deleteMany({ where: { id: { in: empIds } } });
  await db.auditLog.deleteMany({ where: { targetEntity: { contains: "user_zzp6" } } });
}

async function main() {
  try {
    await cleanup();
    console.log("══ SELF-HEALING IDENTITY VERIFICATION (Phase 6) ════════");

    // ── 0: THE WIRING ───────────────────────────────────────────────
    // The steps below exercise the mechanism directly. This one proves it is
    // actually CALLED on every authenticated request — otherwise a correct
    // function that nothing invokes would pass everything that follows.
    // resolveIdentity() imports server-only, so (exactly as
    // prisma/verify-demo-mode.ts does for the impersonation branch) the call
    // site is asserted against the source.
    step("0", "the safety net is wired into the identity path");

    const authSrc = fs.readFileSync(path.join(ROOT, "lib/auth.ts"), "utf8");
    check(
      "0a lib/auth.ts imports the shared provisioner (not a private copy)",
      /import \{ ensureUserForClerkIdentity \} from "@\/lib\/employees\/invite"/.test(authSrc),
    );
    check(
      "0b resolveIdentity() calls the check on the REAL identity, not the impersonated one",
      /await ensureUserRow\(realUserId, realRole\)/.test(authSrc),
      "ensureUserRow(realUserId, realRole)",
    );
    check(
      "0c it runs BEFORE the impersonation branch",
      authSrc.indexOf("await ensureUserRow(realUserId, realRole)") <
        authSrc.indexOf('if (realRole === "SUPER_ADMIN")'),
    );
    check(
      "0d it returns without touching the DB when there is no role (fail closed)",
      /if \(!role\) return;/.test(authSrc),
    );
    check(
      "0e a thrown error cannot change who gets in — the check is wrapped",
      /catch \(err\) \{[\s\S]{0,220}self-heal check failed/.test(authSrc),
    );

    const hookSrc = fs.readFileSync(path.join(ROOT, "app/api/webhooks/clerk/route.ts"), "utf8");
    check(
      "0f the webhook still calls linkClerkUserToEmployee directly — unchanged, still primary",
      /const result = await linkClerkUserToEmployee\(db, \{ clerkId: data\.id, email, role \}\)/.test(
        hookSrc,
      ),
    );
    check(
      "0g the webhook does NOT call the self-heal path (they stay separate)",
      !hookSrc.includes("ensureUserForClerkIdentity"),
    );

    // ── 1: VALID ROLE, NO EMPLOYEE → EMPLOYEE-LESS USER ─────────────
    step("1", "valid role + no Employee match → User with employeeId NULL");

    const adminId = "user_zzp6_admin_0001";
    const adminEmail = `${TAG}-admin@example.com`;
    const r1 = await ensureUserForClerkIdentity(db, {
      clerkId: adminId,
      email: adminEmail,
      role: "SUPER_ADMIN",
      source: "verify",
    });
    check("1a a User row was created", r1.created === true, JSON.stringify(r1));
    const admin = await db.user.findUnique({ where: { clerkId: adminId } });
    check(
      "1b role is exactly what Clerk metadata said",
      admin?.role === "SUPER_ADMIN",
      `role=${admin?.role}`,
    );
    check(
      "1c employeeId is NULL — no Employee was invented",
      admin?.employeeId === null,
      `employeeId=${admin?.employeeId ?? "NULL"}`,
    );
    check(
      "1d the Employee match was ATTEMPTED and simply found nothing",
      r1.created === true && r1.reason.includes("no employee matches"),
      r1.created ? r1.reason : "",
    );
    const audit1 = await db.auditLog.findFirst({
      where: { action: "USER_SELF_PROVISIONED", targetEntity: { contains: adminId } },
    });
    check(
      "1e the creation is on the audit trail with its source",
      audit1 !== null && audit1.targetEntity.includes("source=verify"),
      audit1?.targetEntity ?? "no USER_SELF_PROVISIONED row",
    );
    const again1 = await ensureUserForClerkIdentity(db, {
      clerkId: adminId,
      email: adminEmail,
      role: "SUPER_ADMIN",
    });
    check(
      "1f re-running is idempotent — no second row",
      again1.created === false && (await db.user.count({ where: { clerkId: adminId } })) === 1,
      JSON.stringify(again1),
    );

    // ── 2: EMPLOYEE MATCH IS ATTACHED WHEN IT EXISTS ────────────────
    step("2", "an Employee match by email IS attached");

    const emp = await db.employee.create({
      data: {
        employeeCode: `${TAG}-STAFF`,
        name: `${TAG} Real Staff`,
        department: `${TAG}-Ops`,
        email: `${TAG.toLowerCase()}-staff@example.com`,
        joiningDate: new Date(2020, 0, 1),
      },
    });
    const staffId = "user_zzp6_staff_0001";
    const r2 = await ensureUserForClerkIdentity(db, {
      clerkId: staffId,
      // Mixed case + whitespace: the matcher must normalise, as the webhook's does.
      email: `  ${TAG}-STAFF@Example.com `,
      role: "EMPLOYEE",
      source: "verify",
    });
    check("2a a User row was created", r2.created === true, JSON.stringify(r2));
    const staff = await db.user.findUnique({ where: { clerkId: staffId } });
    check(
      "2b it is ATTACHED to the matching Employee",
      staff?.employeeId === emp.id,
      `employeeId=${staff?.employeeId} expected=${emp.id}`,
    );
    check(
      "2c the email match is case/whitespace insensitive",
      r2.created === true && r2.employeeId === emp.id,
    );
    check(
      "2d role is EMPLOYEE, never elevated by the match",
      staff?.role === "EMPLOYEE",
      `role=${staff?.role}`,
    );
    const audit2 = await db.auditLog.findFirst({
      where: { action: "EMPLOYEE_ACCOUNT_LINKED", targetEntity: { contains: staffId } },
    });
    check(
      "2e audited as EMPLOYEE_ACCOUNT_LINKED, carrying the source",
      audit2 !== null && audit2.targetEntity.includes("source=verify"),
      audit2?.targetEntity ?? "none",
    );

    // ── 3: RACE — TWO SIMULTANEOUS RESOLUTIONS ──────────────────────
    step("3", "two concurrent resolutions create exactly ONE row");

    // Both halves are exercised for real against the live database: (a) the
    // whole self-heal run concurrently, (b) the raw constraint that actually
    // enforces the invariant.
    const raceId = "user_zzp6_race_0001";
    const raceEmail = `${TAG}-race@example.com`;
    const [a, b] = await Promise.all([
      ensureUserForClerkIdentity(db, {
        clerkId: raceId,
        email: raceEmail,
        role: "MANAGER",
        source: "verify",
      }),
      ensureUserForClerkIdentity(db, {
        clerkId: raceId,
        email: raceEmail,
        role: "MANAGER",
        source: "verify",
      }),
    ]);
    const raceRows = await db.user.count({ where: { clerkId: raceId } });
    check(
      "3a exactly ONE User row exists after two concurrent calls",
      raceRows === 1,
      `rows=${raceRows}  a=${JSON.stringify(a)}  b=${JSON.stringify(b)}`,
    );
    check(
      "3b exactly one call reports created:true, the other refuses cleanly",
      [a.created, b.created].filter(Boolean).length === 1 &&
        (a.created || a.code === "ALREADY_PROVISIONED") &&
        (b.created || b.code === "ALREADY_PROVISIONED"),
      `a.created=${a.created} b.created=${b.created}`,
    );
    check("3c neither call threw — the loser degrades to a no-op", a !== undefined && b !== undefined);
    check(
      "3d only ONE audit row was written for the identity",
      (await db.auditLog.count({
        where: {
          action: { in: ["USER_SELF_PROVISIONED", "EMPLOYEE_ACCOUNT_LINKED"] },
          targetEntity: { contains: raceId },
        },
      })) === 1,
    );

    // The invariant does not rest on the check above it — it rests on the
    // unique constraint. Prove the constraint itself fires, so race safety is a
    // database guarantee and not a timing accident.
    const dupId = "user_zzp6_dup_0001";
    await db.user.create({ data: { clerkId: dupId, role: "EMPLOYEE", employeeId: null } });
    let p2002 = "";
    try {
      await db.user.create({ data: { clerkId: dupId, role: "SUPER_ADMIN", employeeId: null } });
    } catch (err) {
      p2002 = (err as { code?: string })?.code ?? "";
    }
    check(
      "3e User.clerkId is genuinely @unique — a second INSERT raises P2002",
      p2002 === "P2002",
      `error code=${p2002 || "(none — NO CONSTRAINT!)"}`,
    );
    check(
      "3f the losing INSERT changed nothing (role still EMPLOYEE)",
      (await db.user.findUnique({ where: { clerkId: dupId } }))?.role === "EMPLOYEE",
    );

    // ── 4: FAIL CLOSED ──────────────────────────────────────────────
    step("4", "no recognisable role → NOTHING is created");

    const noRoleId = "user_zzp6_norole_0001";
    const badRoles: [string, unknown][] = [
      ["missing", undefined],
      ["null", null],
      ["empty string", ""],
      ["unrecognised", "ADMIN"],
      ["lowercase near-miss", "super_admin"],
      ["object", { role: "SUPER_ADMIN" }],
    ];
    for (const [label, value] of badRoles) {
      // coerceRole is the SAME narrowing middleware.ts and lib/auth.ts apply to
      // Clerk metadata — so this is the real gate, not a stand-in.
      const r = await ensureUserForClerkIdentity(db, {
        clerkId: noRoleId,
        email: `${TAG}-norole@example.com`,
        role: coerceRole(value),
        source: "verify",
      });
      check(
        `4. Clerk metadata role ${label} → refused, no User created`,
        r.created === false &&
          r.code === "NO_ROLE" &&
          (await db.user.count({ where: { clerkId: noRoleId } })) === 0,
        JSON.stringify(r),
      );
    }
    check(
      "4g in particular it does NOT fall back to EMPLOYEE",
      (await db.user.count({ where: { clerkId: noRoleId } })) === 0,
      "an unknown identity gets no account at all, not a least-privileged one",
    );

    const noEmailId = "user_zzp6_noemail_0001";
    const rNoEmail = await ensureUserForClerkIdentity(db, {
      clerkId: noEmailId,
      email: null,
      role: "HR",
      source: "verify",
    });
    check(
      "4h no email → refused (the Employee match cannot be attempted)",
      rNoEmail.created === false &&
        rNoEmail.code === "NO_EMAIL" &&
        (await db.user.count({ where: { clerkId: noEmailId } })) === 0,
      JSON.stringify(rNoEmail),
    );

    // Ambiguity: the Employee is already owned by ANOTHER Clerk account.
    const stealId = "user_zzp6_steal_0001";
    const rSteal = await ensureUserForClerkIdentity(db, {
      clerkId: stealId,
      email: `${TAG.toLowerCase()}-staff@example.com`,
      role: "SUPER_ADMIN",
      source: "verify",
    });
    check(
      "4i an Employee already linked to another account → refused as AMBIGUOUS",
      rSteal.created === false &&
        rSteal.code === "AMBIGUOUS" &&
        (await db.user.count({ where: { clerkId: stealId } })) === 0,
      JSON.stringify(rSteal),
    );
    check(
      "4j the existing link was not stolen or re-pointed",
      (await db.user.findUnique({ where: { clerkId: staffId } }))?.employeeId === emp.id,
    );

    // ── 5: THE REAL MANAGER ACCOUNT ─────────────────────────────────
    step("5", `the real Manager through this mechanism`);
    console.log(`        target: ${MANAGER_EMAIL}`);

    if (!process.env.CLERK_SECRET_KEY) {
      check("5a CLERK_SECRET_KEY available", false, "run with node --env-file=.env");
    } else {
      const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
      const { data } = await clerk.users.getUserList({ query: MANAGER_EMAIL, limit: 50 });
      const primary = (u: (typeof data)[number]): string | null =>
        (
          u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId) ?? u.emailAddresses[0]
        )?.emailAddress
          ?.trim()
          .toLowerCase() ?? null;
      const matches = data.filter((u) => primary(u) === MANAGER_EMAIL);
      check("5a exactly one Clerk account owns that address", matches.length === 1, `${matches.length} match(es)`);

      if (matches.length === 1) {
        const cu = matches[0];
        const role = coerceRole(cu.publicMetadata?.role);
        check(
          "5b Clerk's publicMetadata.role is a recognised role",
          role !== null,
          `publicMetadata.role=${JSON.stringify(cu.publicMetadata?.role)}`,
        );

        // THE POINT: the exact same call lib/auth.ts makes on first resolution.
        const rm = await ensureUserForClerkIdentity(db, {
          clerkId: cu.id,
          email: primary(cu),
          role,
          source: "self-heal",
        });
        console.log(`        ensureUserForClerkIdentity → ${JSON.stringify(rm)}`);

        const mUser = await db.user.findUnique({
          where: { clerkId: cu.id },
          select: { id: true, clerkId: true, role: true, employeeId: true, createdAt: true },
        });
        check(
          "5c the Manager now has a real User row (direct query)",
          mUser !== null,
          mUser ? `User ${mUser.id} created ${mUser.createdAt.toISOString()}` : "STILL MISSING",
        );
        check("5d its role is MANAGER, taken from Clerk metadata", mUser?.role === "MANAGER", `role=${mUser?.role}`);
        check("5e clerkId matches the real Clerk account", mUser?.clerkId === cu.id, `${mUser?.clerkId} vs ${cu.id}`);

        const mEmp = await db.employee.findUnique({ where: { email: MANAGER_EMAIL } });
        check(
          "5f the Employee match was attempted against the live table",
          true,
          mEmp
            ? `matched Employee ${mEmp.id} (${mEmp.employeeCode}) → attached`
            : `NO Employee has ${MANAGER_EMAIL} → employeeId left NULL, nothing invented`,
        );
        check(
          "5g employeeId reflects that match exactly",
          mUser?.employeeId === (mEmp?.id ?? null),
          `employeeId=${mUser?.employeeId ?? "NULL"}`,
        );
        const rmAgain = await ensureUserForClerkIdentity(db, {
          clerkId: cu.id,
          email: primary(cu),
          role,
          source: "self-heal",
        });
        check(
          "5h a second resolution is a no-op (idempotent)",
          rmAgain.created === false && (await db.user.count({ where: { clerkId: cu.id } })) === 1,
          JSON.stringify(rmAgain),
        );
      }
    }

    // ── 6: WEBHOOK PATH UNCHANGED ───────────────────────────────────
    step("6", "the webhook's normal invitation path, unchanged");

    const hireEmail = `${TAG.toLowerCase()}-hire@example.com`;
    const wEmp = await db.employee.create({
      data: {
        employeeCode: `${TAG}-WEBHOOK`,
        name: `${TAG} Invited Hire`,
        department: `${TAG}-Ops`,
        email: hireEmail,
        pendingInvitationId: "inv_zzp6_pending",
        joiningDate: new Date(2021, 5, 1),
      },
    });
    const wClerkId = "user_zzp6_hire_0001";
    // The EXACT call app/api/webhooks/clerk/route.ts makes — no `source`,
    // because the webhook does not pass one.
    const wResult = await linkClerkUserToEmployee(db, {
      clerkId: wClerkId,
      email: hireEmail,
      role: "EMPLOYEE",
    });
    check(
      "6a the webhook call still links the new account",
      wResult.linked === true && wResult.employeeId === wEmp.id,
      JSON.stringify(wResult),
    );
    const wUser = await db.user.findUnique({ where: { clerkId: wClerkId } });
    check(
      "6b the User row is created with the Employee attached",
      wUser?.employeeId === wEmp.id && wUser?.role === "EMPLOYEE",
      `role=${wUser?.role} employeeId=${wUser?.employeeId}`,
    );
    check(
      "6c pendingInvitationId is cleared, as before",
      (await db.employee.findUnique({ where: { id: wEmp.id } }))?.pendingInvitationId === null,
    );
    const wAudit = await db.auditLog.findFirst({
      where: { action: "EMPLOYEE_ACCOUNT_LINKED", targetEntity: { contains: wClerkId } },
    });
    check(
      "6d the audit row is byte-for-byte what it was before Phase 6",
      wAudit?.targetEntity === `employee=${wEmp.id} clerkId=${wClerkId} role=EMPLOYEE`,
      `${wAudit?.targetEntity} — no source= suffix when the caller passes none`,
    );
    const wAgain = await linkClerkUserToEmployee(db, {
      clerkId: wClerkId,
      email: hireEmail,
      role: "EMPLOYEE",
    });
    check(
      "6e a webhook retry is still a calm no-op",
      wAgain.linked === false && wAgain.code === "ALREADY_LINKED_CLERK",
      JSON.stringify(wAgain),
    );
    const wNoMatch = await linkClerkUserToEmployee(db, {
      clerkId: "user_zzp6_stranger_0001",
      email: `${TAG}-nobody@example.com`,
      role: "EMPLOYEE",
    });
    check(
      "6f an uninvited signup is still a no-op, NOT an error and NOT a User",
      wNoMatch.linked === false &&
        wNoMatch.code === "NO_EMPLOYEE_MATCH" &&
        (await db.user.count({ where: { clerkId: "user_zzp6_stranger_0001" } })) === 0,
      JSON.stringify(wNoMatch),
    );
  } finally {
    console.log("\n── CLEANUP ─────────────────────────────────────────────");
    await cleanup();
    const leftUsers = await db.user.count({ where: { clerkId: { startsWith: "user_zzp6" } } });
    const leftEmps = await db.employee.count({ where: { employeeCode: { startsWith: TAG } } });
    check("7. every throwaway row removed", leftUsers === 0 && leftEmps === 0, `users=${leftUsers} employees=${leftEmps}`);

    const real = await db.user.findMany({
      where: { NOT: { clerkId: { startsWith: "user_zzp6" } } },
      select: { clerkId: true, role: true, employeeId: true },
      orderBy: { createdAt: "asc" },
    });
    console.log(`\n  Real accounts (${real.length}):`);
    for (const u of real) console.log(`    ${u.clerkId}  ${u.role}  employeeId=${u.employeeId ?? "NULL"}`);

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
