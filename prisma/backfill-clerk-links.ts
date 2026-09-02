/**
 * ONE-SHOT BACKFILL: link the Clerk accounts that exist today but have no
 * SESS User row.
 *
 * WHY THIS IS NEEDED
 * Account linking has only ever happened one way — the user.created webhook at
 * app/api/webhooks/clerk/route.ts calling linkClerkUserToEmployee(). That
 * endpoint was never registered in the Clerk dashboard, so it has never fired,
 * so every account created before the endpoint was registered is authenticated
 * in Clerk but invisible to SESS: no User row, therefore no role, therefore no
 * access to anything role-gated. Fixing the webhook only helps accounts created
 * AFTER it starts working; the existing ones need this.
 *
 * WHAT IT DOES, per Clerk account, matching on email:
 *   1. finds the Employee whose (lowercased, unique) email matches;
 *   2. calls the SAME linkClerkUserToEmployee() the webhook calls — no second
 *      implementation of the linking rules, so idempotency, the audit row and
 *      the pendingInvitationId clear all behave identically;
 *   3. revokes any invitation still pending in Clerk for that address.
 *
 * WHY STEP 3: an invitation is a SIGN-UP token. Once the address owns an
 * account it can never be accepted, so a pending one can never resolve itself —
 * it just sits in the dashboard forever. Worse, it carries the role it was
 * issued with in publicMetadata (typically EMPLOYEE), which contradicts the
 * real role this backfill just wrote. Revoking removes both problems.
 *
 * ─── ROLE RESOLUTION: WHY IT REFUSES TO GUESS ────────────────────────────
 * The role must come from somewhere trustworthy. It reads Clerk's
 * publicMetadata.role (what the invitation carried). If that is missing or not
 * a valid Role, the account is REPORTED AND SKIPPED rather than defaulted to
 * EMPLOYEE — silently minting an EMPLOYEE row for a Super Admin would lock a
 * real administrator out of their own system, and the fix (a role change) is
 * itself an admin action. Supply the role explicitly instead:
 *
 *   --role=someone@example.com:SUPER_ADMIN
 *
 * ─── SAFETY ──────────────────────────────────────────────────────────────
 * DRY RUN BY DEFAULT. It prints exactly what it would do and writes nothing.
 * Pass --apply to perform the writes. It only ever CREATES User rows for
 * employees that have none; it never updates or deletes an existing User, and
 * never touches an Employee beyond the pendingInvitationId clear that
 * linkClerkUserToEmployee already does.
 *
 * Run:
 *   node --env-file=.env prisma/backfill-clerk-links.ts
 *   node --env-file=.env prisma/backfill-clerk-links.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { createClerkClient } from "@clerk/backend";
import { linkClerkUserToEmployee } from "../lib/employees/invite.ts";
import { coerceRole, type Role } from "../lib/auth-types.ts";

const db = new PrismaClient();

const APPLY = process.argv.includes("--apply");

/** --role=email:ROLE, repeatable. Overrides Clerk publicMetadata. */
const ROLE_OVERRIDES = new Map<string, Role>();
for (const arg of process.argv) {
  if (!arg.startsWith("--role=")) continue;
  const raw = arg.slice("--role=".length);
  const idx = raw.lastIndexOf(":");
  const email = raw.slice(0, idx).trim().toLowerCase();
  const role = coerceRole(raw.slice(idx + 1).trim().toUpperCase());
  if (!email || !role) {
    console.error(`Bad --role argument: ${arg}  (expected --role=email@x.com:SUPER_ADMIN)`);
    process.exit(2);
  }
  ROLE_OVERRIDES.set(email, role);
}

if (!process.env.CLERK_SECRET_KEY) {
  console.error("CLERK_SECRET_KEY is not set. Run with: node --env-file=.env ...");
  process.exit(2);
}
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

function primaryEmail(u: {
  primaryEmailAddressId: string | null;
  emailAddresses: { id: string; emailAddress: string }[];
}): string | null {
  const match =
    u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId) ?? u.emailAddresses[0];
  return match ? match.emailAddress.trim().toLowerCase() : null;
}

/**
 * Revoke every still-pending Clerk invitation for an address. Best-effort: a
 * failure here is reported but never fails the backfill — the User row is the
 * thing that matters and it is already written by this point.
 */
async function revokePending(email: string): Promise<string[]> {
  const revoked: string[] = [];
  const { data } = await clerk.invitations.getInvitationList({ query: email, status: "pending" });
  for (const inv of data) {
    if (inv.emailAddress.trim().toLowerCase() !== email) continue; // `query` is fuzzy
    if (!APPLY) {
      revoked.push(inv.id);
      continue;
    }
    try {
      await clerk.invitations.revokeInvitation(inv.id);
      revoked.push(inv.id);
    } catch (err) {
      console.log(`      ! could not revoke ${inv.id}: ${String(err)}`);
    }
  }
  return revoked;
}

async function main() {
  console.log(
    `\n${"═".repeat(74)}\n  CLERK → SESS ACCOUNT BACKFILL   ${APPLY ? "*** APPLY (writing) ***" : "dry run (no writes)"}\n${"═".repeat(74)}`,
  );

  const { data: clerkUsers } = await clerk.users.getUserList({ limit: 100 });
  console.log(`\nClerk accounts found: ${clerkUsers.length}\n`);

  let linked = 0;
  let skipped = 0;
  const unresolved: string[] = [];

  for (const u of clerkUsers) {
    const email = primaryEmail(u);
    console.log(`─ ${u.id}  ${email ?? "(no email)"}`);

    if (!email) {
      console.log("    SKIP: account has no email address to match on");
      skipped++;
      continue;
    }

    const already = await db.user.findUnique({
      where: { clerkId: u.id },
      select: { role: true, employeeId: true },
    });
    if (already) {
      console.log(`    already linked → employee ${already.employeeId} as ${already.role}`);
      skipped++;
      continue;
    }

    const emp = await db.employee.findUnique({
      where: { email },
      select: { id: true, employeeCode: true, name: true, active: true, pendingInvitationId: true },
    });
    if (!emp) {
      console.log("    SKIP: no Employee row has this email");
      skipped++;
      unresolved.push(`${email} — no matching employee`);
      continue;
    }

    const role = ROLE_OVERRIDES.get(email) ?? coerceRole(u.publicMetadata?.role);
    const source = ROLE_OVERRIDES.has(email) ? "--role override" : "Clerk publicMetadata.role";
    if (!role) {
      console.log(
        `    SKIP: no usable role (Clerk publicMetadata.role = ${JSON.stringify(u.publicMetadata?.role)}).\n` +
          `          Re-run with --role=${email}:SUPER_ADMIN|HR|MANAGER|EMPLOYEE`,
      );
      skipped++;
      unresolved.push(`${email} — role unknown, needs --role=`);
      continue;
    }

    console.log(
      `    match: ${emp.employeeCode} ${emp.name}${emp.active ? "" : " (INACTIVE)"} → role ${role} (from ${source})`,
    );

    if (!APPLY) {
      console.log(`    would CREATE User row + audit, and clear pendingInvitationId`);
      const wouldRevoke = await revokePending(email);
      if (wouldRevoke.length)
        console.log(`    would REVOKE pending invitation(s): ${wouldRevoke.join(", ")}`);
      linked++;
      continue;
    }

    const result = await linkClerkUserToEmployee(db, { clerkId: u.id, email, role });
    if (!result.linked) {
      console.log(`    SKIP: ${result.reason}`);
      skipped++;
      continue;
    }
    console.log(`    LINKED → User ${result.userId} on employee ${result.employeeId}`);
    const revoked = await revokePending(email);
    if (revoked.length) console.log(`    REVOKED pending invitation(s): ${revoked.join(", ")}`);
    linked++;
  }

  // ── Final state, read back from the database ───────────────────────────
  console.log(`\n${"─".repeat(74)}\nUSER ROWS NOW IN SESS\n${"─".repeat(74)}`);
  const users = await db.user.findMany({
    select: {
      clerkId: true,
      role: true,
      employee: { select: { employeeCode: true, name: true, email: true } },
    },
    orderBy: { role: "asc" },
  });
  for (const row of users) {
    console.log(
      `  ${row.role.padEnd(12)} ${row.clerkId.padEnd(34)} ${row.employee?.employeeCode ?? "—"} ${row.employee?.name ?? "(no employee)"} <${row.employee?.email ?? "—"}>`,
    );
  }

  console.log(
    `\n${APPLY ? "linked" : "would link"}: ${linked}   skipped: ${skipped}   total User rows: ${users.length}`,
  );
  if (unresolved.length) {
    console.log(`\nNEEDS ATTENTION:`);
    for (const line of unresolved) console.log(`  · ${line}`);
  }
  if (!APPLY) console.log(`\nDry run only — nothing was written. Re-run with --apply to commit.`);
}

main()
  .catch((err) => {
    console.error("BACKFILL FAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
