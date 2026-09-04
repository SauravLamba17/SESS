/**
 * ONE-SHOT: create the missing SESS User row for an administrator who
 * authenticates through Clerk but has no application identity in SESS.
 *
 * WHY THIS EXISTS
 * Until now the ONLY code path that creates a User row was
 * linkClerkUserToEmployee() (lib/employees/invite.ts), and it matches an
 * EXISTING Employee by email. SESS therefore had no way at all to create an
 * administrator who is not also an employee: Clerk knew who the Super Admin
 * was, and the application database did not. The consequences were real —
 * absent from Roles & Permissions, uncounted by the last-admin safety lock,
 * undercounted in role reporting, and (before the notification change that
 * ships alongside this) unreachable by system alerts.
 *
 * WHAT IT CREATES, AND WHAT IT DELIBERATELY DOES NOT
 *   creates : User { clerkId, role, employeeId: NULL } + an AuditLog row
 *   creates : nothing else
 *   NEVER   : an Employee record. employeeId = NULL is the CORRECT
 *             representation of an administrator with no HR profile, and
 *             inventing a fake Employee would write organizational facts that
 *             are not true — pollution of HR data that every report, roster and
 *             payroll run would then have to carry forever.
 *
 * ─── ON employeeId = NULL ────────────────────────────────────────────────
 * A null employeeId is a legitimate state, not a Super Admin marker. Nothing in
 * this script, and nothing anywhere else in the codebase, should ever infer a
 * role from it. Authorization is decided by User.role, which is why this script
 * REFUSES to guess the role (see below) rather than defaulting it.
 *
 * ─── SAFETY ──────────────────────────────────────────────────────────────
 * DRY RUN BY DEFAULT — prints exactly what it would do and writes nothing.
 * Pass --apply to commit. It is idempotent: it only ever CREATES a User row for
 * a Clerk id that has none, and re-running after a successful apply reports the
 * existing row and exits 0 without a second write. It never updates or deletes
 * any row, and never touches the Employee table.
 *
 * Run:
 *   node --env-file=.env prisma/provision-super-admin-user.ts --email=someone@example.com
 *   node --env-file=.env prisma/provision-super-admin-user.ts --email=someone@example.com --apply
 *
 * Optional:
 *   --role=SUPER_ADMIN   override the role instead of reading Clerk metadata
 */
import { PrismaClient } from "@prisma/client";
import { createClerkClient } from "@clerk/backend";
import { coerceRole, type Role } from "../lib/auth-types.ts";

const db = new PrismaClient();

const APPLY = process.argv.includes("--apply");

function argValue(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : null;
}

const EMAIL = (argValue("email") ?? "").toLowerCase();
const ROLE_OVERRIDE = argValue("role");

if (!EMAIL) {
  console.error(
    "An email is required:\n" +
      "  node --env-file=.env prisma/provision-super-admin-user.ts --email=admin@example.com",
  );
  process.exit(2);
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

async function main() {
  console.log(
    `\n${"═".repeat(74)}\n  PROVISION SUPER ADMIN USER   ${APPLY ? "*** APPLY (writing) ***" : "dry run (no writes)"}\n${"═".repeat(74)}\n`,
  );
  console.log(`Target email: ${EMAIL}\n`);

  // ── 1. Find the Clerk account ─────────────────────────────────────────
  // `query` is fuzzy, so the address is re-checked exactly below rather than
  // trusting the first result.
  const { data } = await clerk.users.getUserList({ query: EMAIL, limit: 50 });
  const matches = data.filter((u) => primaryEmail(u) === EMAIL);

  if (matches.length === 0) {
    console.error(`FAILED: no Clerk account has the primary email ${EMAIL}.`);
    process.exitCode = 1;
    return;
  }
  if (matches.length > 1) {
    // Never guess between two administrators.
    console.error(
      `FAILED: ${matches.length} Clerk accounts share ${EMAIL}: ${matches.map((m) => m.id).join(", ")}.`,
    );
    process.exitCode = 1;
    return;
  }
  const clerkUser = matches[0];
  console.log(`Clerk account : ${clerkUser.id}`);

  // ── 2. Resolve the role — refuse to guess ─────────────────────────────
  const role: Role | null = ROLE_OVERRIDE
    ? coerceRole(ROLE_OVERRIDE.toUpperCase())
    : coerceRole(clerkUser.publicMetadata?.role);
  const roleSource = ROLE_OVERRIDE ? "--role override" : "Clerk publicMetadata.role";
  if (!role) {
    console.error(
      `FAILED: no usable role (${roleSource} = ${JSON.stringify(clerkUser.publicMetadata?.role)}).\n` +
        `        Silently defaulting a role would be an authorization decision made by a script.\n` +
        `        Re-run with --role=SUPER_ADMIN`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`Role          : ${role}  (from ${roleSource})`);
  console.log(`employeeId    : NULL  (no Employee record is created — by design)\n`);

  // ── 3. Idempotency: does a User row already exist? ────────────────────
  const existing = await db.user.findUnique({
    where: { clerkId: clerkUser.id },
    select: { id: true, role: true, employeeId: true, createdAt: true },
  });
  if (existing) {
    console.log(
      `Already provisioned — nothing to do.\n` +
        `  User ${existing.id}  role=${existing.role}  employeeId=${existing.employeeId ?? "NULL"}  created ${existing.createdAt.toISOString()}`,
    );
    if (existing.role !== role)
      console.log(
        `\n  NOTE: the existing row's role (${existing.role}) differs from ${role}.\n` +
          `        This script does not change roles — use Roles & Permissions, which\n` +
          `        audits the change and enforces the last-admin lock.`,
      );
    return;
  }

  if (!APPLY) {
    console.log(
      `Would CREATE User { clerkId: "${clerkUser.id}", role: ${role}, employeeId: null }\n` +
        `Would CREATE AuditLog SUPER_ADMIN_USER_PROVISIONED\n\n` +
        `Dry run only — nothing was written. Re-run with --apply to commit.`,
    );
    return;
  }

  // ── 4. Create, with the audit row in the SAME transaction ─────────────
  // One consequential action, one atomic record of it: an unaudited
  // administrator appearing in the database is exactly what must not happen.
  const [user] = await db.$transaction([
    db.user.create({ data: { clerkId: clerkUser.id, role, employeeId: null } }),
    db.auditLog.create({
      data: {
        // The administrator is provisioning their own application identity;
        // no other party performed this. The script is named in targetEntity
        // so the trail says how the row came to exist.
        actorUserId: clerkUser.id,
        action: "SUPER_ADMIN_USER_PROVISIONED",
        targetEntity: `clerkId=${clerkUser.id} email=${EMAIL} role=${role} employeeId=null script=provision-super-admin-user`,
      },
    }),
  ]);

  // ── 5. Verify by reading it back ──────────────────────────────────────
  const check = await db.user.findUnique({
    where: { clerkId: clerkUser.id },
    select: { id: true, clerkId: true, role: true, employeeId: true },
  });
  const ok =
    check !== null &&
    check.clerkId === clerkUser.id &&
    check.role === role &&
    check.employeeId === null;

  console.log(`CREATED User ${user.id}`);
  console.log(`\nVerification (read back from the database):`);
  console.log(`  clerkId    ${check?.clerkId}          ${check?.clerkId === clerkUser.id ? "OK" : "MISMATCH"}`);
  console.log(`  role       ${check?.role}             ${check?.role === role ? "OK" : "MISMATCH"}`);
  console.log(`  employeeId ${check?.employeeId ?? "NULL"}  ${check?.employeeId === null ? "OK" : "MISMATCH"}`);

  if (!ok) {
    console.error(`\nVERIFICATION FAILED — the row does not match what was requested.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nDone. Audit: SUPER_ADMIN_USER_PROVISIONED`);
}

main()
  .catch((err) => {
    console.error("PROVISIONING FAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
