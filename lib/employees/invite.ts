// Same deliberate pattern as lib/employees/onboard.ts: NOT `server-only`, no
// db client import, no Clerk import. The caller supplies the Prisma client and
// the Clerk createInvitation function (routes pass the real one from
// lib/employees/invite-clerk.ts; the verify script passes a stub), so the
// verification script exercises the REAL invitation/link logic without needing
// Next.js runtime or a live Clerk key.
import type { PrismaClient } from "@prisma/client";
import type { Role } from "@/lib/auth-types";

/**
 * ONE implementation of "send this employee a Clerk invitation", shared by:
 *   1. app/api/hr/employee/route.ts        — optional at manual onboarding
 *   2. app/api/hr/employee/invite/route.ts — Send/Resend from the roster
 *      (covers bulk-imported employees, where invitations are skipped at
 *      import time by design)
 *   3. app/api/hr/offer/status/route.ts    — optional at hire-conversion
 *
 * Called AFTER the onboarding transaction commits, never inside it: an
 * external HTTP call must not hold a DB transaction open, and the Employee
 * record must survive even when the invitation fails.
 */

/**
 * Note: the accept link's destination (`redirectUrl`) is NOT set here. It is
 * added by the real adapter in lib/employees/invite-clerk.ts, which resolves it
 * from lib/app-url.ts — that file explains why. Deliberately absent from this
 * signature so this module keeps importing nothing but types.
 */
export type CreateInvitationFn = (params: {
  emailAddress: string;
  publicMetadata: { role: Role };
  ignoreExisting: boolean;
}) => Promise<{ id: string }>;

/**
 * Look up an EXISTING Clerk account by email. Injected for the same reason as
 * CreateInvitationFn: this module must keep importing nothing but types.
 * Returns null when no account owns that address.
 */
export type FindClerkUserByEmailFn = (email: string) => Promise<{ id: string } | null>;

export type InviteResult =
  /** An invitation was created and emailed. */
  | { ok: true; linked: false; invitationId: string; message: string }
  /** The address already had a Clerk account — linked on the spot, no invitation. */
  | { ok: true; linked: true; userId: string; employeeId: string; message: string }
  | {
      ok: false;
      code: "NOT_FOUND" | "ALREADY_LINKED" | "NO_EMAIL" | "CLERK_ERROR" | "INACTIVE" | "REDACTED";
      message: string;
    };

/** Best-effort extraction of Clerk's human-readable error message. */
function clerkErrorMessage(err: unknown): string {
  const e = err as { errors?: { message?: string; longMessage?: string }[]; message?: string };
  return (
    e?.errors?.[0]?.longMessage ?? e?.errors?.[0]?.message ?? e?.message ?? "Clerk API call failed"
  );
}

export async function sendEmployeeInvitation(
  db: PrismaClient,
  args: { employeeId: string; email?: string | null; role: Role; actorUserId: string },
  createInvitation: CreateInvitationFn,
  findClerkUserByEmail: FindClerkUserByEmailFn,
): Promise<InviteResult> {
  const emp = await db.employee.findUnique({
    where: { id: args.employeeId },
    select: {
      id: true,
      email: true,
      active: true,
      redactedAt: true,
      user: { select: { id: true } },
    },
  });
  if (!emp) return { ok: false, code: "NOT_FOUND", message: "Employee not found" };
  if (emp.user)
    return { ok: false, code: "ALREADY_LINKED", message: "This employee already has an active account" };

  // ─── OFFBOARDED / REDACTED GUARD ───────────────────────────────────────
  // This function ENDS by writing `email` and `pendingInvitationId` onto the
  // Employee row. For a redacted ex-employee those are exactly the two fields
  // Phase 13's retention policy deliberately erased (lib/employees/retention.ts
  // redactionPatch sets email: null, pendingInvitationId: null), so inviting
  // one would silently UN-REDACT the record — writing a fresh personal email
  // back onto data that was erased under a statutory retention rule — and hand
  // login access back to someone who has left.
  //
  // The Employee Master already hides the Invite button behind `e.active`, but
  // that is presentation. This route is reachable directly, so the rule belongs
  // here, in the shared function all three invite paths call: manual onboarding
  // and hire-conversion invite freshly-created employees and are unaffected.
  if (emp.redactedAt)
    return {
      ok: false,
      code: "REDACTED",
      message:
        "This former employee's personal data was redacted under the retention policy. Inviting them would rewrite erased fields — onboard them as a new employee instead.",
    };
  if (!emp.active)
    return {
      ok: false,
      code: "INACTIVE",
      message:
        "This employee is offboarded. Re-onboard them before sending an invitation.",
    };

  const email = (args.email?.trim() || emp.email || "").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { ok: false, code: "NO_EMAIL", message: "A valid email address is required to send an invitation" };

  // ─── ALREADY-REGISTERED ADDRESS → LINK NOW, DO NOT INVITE ──────────────
  // A Clerk invitation is a SIGN-UP token: accepting one is what fires the
  // user.created webhook that linkClerkUserToEmployee() consumes. An address
  // that already owns a Clerk account can never sign up again, so it can never
  // produce user.created, so the invitation below would be permanently
  // unresolvable — it would sit "pending" forever while the person signs in
  // normally and lands in the app with no User row: authenticated, but
  // unrecognised by every role check.
  //
  // Clerk does not stop us making that doomed invitation, because the
  // `ignoreExisting: true` below suppresses exactly the duplicate_record error
  // that would otherwise surface this case ("...or if the email address
  // already exists in the application"). That flag is still correct for its
  // real purpose — resending after a lapsed invitation — so the check moves
  // here instead, ahead of it.
  //
  // Linking directly is the right outcome rather than an error to HR: the
  // person HAS an account, the Employee row is theirs, and there is nothing
  // HR could do differently. This lives in the shared function so all three
  // invite paths (manual onboarding, roster resend, hire-conversion) get it.
  let existingClerkUser: { id: string } | null;
  try {
    existingClerkUser = await findClerkUserByEmail(email);
  } catch (err) {
    // Fail CLOSED. Falling through to createInvitation on a lookup outage
    // would silently recreate the doomed-invitation bug; HR can retry.
    return { ok: false, code: "CLERK_ERROR", message: clerkErrorMessage(err) };
  }

  if (existingClerkUser) {
    // linkClerkUserToEmployee() matches the Employee BY EMAIL, so the address
    // has to be on the row before it runs — otherwise a newly-supplied address
    // would match nothing (or, worse, somebody else). This is the same write
    // the invitation path makes at the end; Employee.email is unique, so a
    // collision surfaces as P2002 to the caller exactly as it does there.
    await db.employee.update({ where: { id: emp.id }, data: { email } });

    const link = await linkClerkUserToEmployee(db, {
      clerkId: existingClerkUser.id,
      email,
      role: args.role,
    });
    if (!link.linked)
      return {
        ok: false,
        code: "ALREADY_LINKED",
        message: `That email already has a SESS login, and it could not be attached to this employee: ${link.reason}`,
      };

    await db.auditLog.create({
      data: {
        actorUserId: args.actorUserId,
        action: "EMPLOYEE_INVITATION_SKIPPED_EXISTING_ACCOUNT",
        targetEntity: `employee=${emp.id} role=${args.role} clerkId=${existingClerkUser.id}`,
      },
    });

    // ponytail: any invitation already pending in Clerk for this address is
    // left alone — it is unacceptable-by-construction and simply expires. Add
    // a revokeInvitation injection here if stale pending invitations in the
    // Clerk dashboard become confusing. prisma/backfill-clerk-links.ts revokes
    // the ones that already accumulated.
    return {
      ok: true,
      linked: true,
      userId: link.userId,
      employeeId: link.employeeId,
      message:
        "That email already had a SESS account — it has been linked to this employee immediately, as " +
        `${args.role}. No invitation was sent; they can sign in with their existing password.`,
    };
  }

  let invitationId: string;
  try {
    // ignoreExisting: a resend after a lapsed/lost invitation must not 400.
    const inv = await createInvitation({
      emailAddress: email,
      publicMetadata: { role: args.role },
      ignoreExisting: true,
    });
    invitationId = inv.id;
  } catch (err) {
    return { ok: false, code: "CLERK_ERROR", message: clerkErrorMessage(err) };
  }

  // The invitation went out — record it. If THIS write fails the invitation
  // still exists in Clerk and the webhook link still works (it matches by
  // email), so a failure here degrades to "HR sees stale status", not loss.
  await db.employee.update({
    where: { id: emp.id },
    data: { email, pendingInvitationId: invitationId },
  });
  await db.auditLog.create({
    data: {
      actorUserId: args.actorUserId,
      action: "EMPLOYEE_INVITATION_SENT",
      targetEntity: `employee=${emp.id} role=${args.role} invitation=${invitationId}`,
    },
  });
  return {
    ok: true,
    linked: false,
    invitationId,
    message: `Login invitation sent to ${email}.`,
  };
}

export type LinkResult =
  | { linked: true; userId: string; employeeId: string }
  | { linked: false; code: LinkFailure; reason: string };

/**
 * WHY a link did not happen. The three cases are NOT interchangeable and the
 * self-healing caller below branches on them, so they must not be told apart
 * by matching on `reason`'s prose:
 *
 *   ALREADY_LINKED_CLERK — this Clerk id already has a User row. Benign: a
 *                          webhook retry, or a concurrent request that won.
 *   NO_EMPLOYEE_MATCH    — no Employee owns this address. Benign and EXPECTED
 *                          for an administrator with no HR profile; this is the
 *                          one case where an employee-less User is correct.
 *   EMPLOYEE_TAKEN       — an Employee owns the address but is already linked
 *                          to a DIFFERENT Clerk account. AMBIGUOUS — two
 *                          identities claim one person — so callers must fail
 *                          closed here, never invent a second account.
 */
export type LinkFailure = "ALREADY_LINKED_CLERK" | "NO_EMPLOYEE_MATCH" | "EMPLOYEE_TAKEN";

/**
 * Webhook side: correlate a Clerk user.created event to its Employee by email
 * and create the User row (clerkId + role + employeeId) that has been missing
 * since Phase 0. Every non-match is a calm no-op — an uninvited signup is
 * legitimate, not an error.
 */
export async function linkClerkUserToEmployee(
  db: PrismaClient,
  args: { clerkId: string; email: string; role: Role; source?: string },
): Promise<LinkResult> {
  const email = args.email.trim().toLowerCase();

  // Idempotency: Clerk retries deliver the same event more than once.
  const existing = await db.user.findUnique({
    where: { clerkId: args.clerkId },
    select: { id: true },
  });
  if (existing)
    return {
      linked: false,
      code: "ALREADY_LINKED_CLERK",
      reason: `clerkId ${args.clerkId} is already linked`,
    };

  const emp = await db.employee.findUnique({
    where: { email },
    select: { id: true, user: { select: { id: true } } },
  });
  if (!emp)
    return { linked: false, code: "NO_EMPLOYEE_MATCH", reason: `no employee matches email ${email}` };
  if (emp.user)
    return {
      linked: false,
      code: "EMPLOYEE_TAKEN",
      reason: `employee ${emp.id} already has a linked account`,
    };

  const [user] = await db.$transaction([
    db.user.create({
      data: { clerkId: args.clerkId, role: args.role, employeeId: emp.id },
    }),
    db.employee.update({
      where: { id: emp.id },
      data: { pendingInvitationId: null },
    }),
    db.auditLog.create({
      data: {
        // The accepting user is the actor — nobody else performed this.
        actorUserId: args.clerkId,
        action: "EMPLOYEE_ACCOUNT_LINKED",
        targetEntity:
          `employee=${emp.id} clerkId=${args.clerkId} role=${args.role}` +
          (args.source ? ` source=${args.source}` : ""),
      },
    }),
  ]);
  return { linked: true, userId: user.id, employeeId: emp.id };
}

export type EnsureUserResult =
  /** A User row now exists because THIS call created it. */
  | { created: true; userId: string; employeeId: string | null; reason: string }
  /** No row was created — either one already existed, or we refused. */
  | { created: false; code: EnsureRefusal; reason: string };

export type EnsureRefusal =
  /** Benign: the row was already there (or a concurrent request created it). */
  | "ALREADY_PROVISIONED"
  /** Refused: Clerk's publicMetadata.role is missing or not a recognised Role. */
  | "NO_ROLE"
  /** Refused: no usable email, so the Employee match could not even be attempted. */
  | "NO_EMAIL"
  /** Refused: the matching Employee belongs to a different Clerk account. */
  | "AMBIGUOUS"
  /** Refused: the database rejected the write for a reason other than the race. */
  | "CONFLICT";

/**
 * PHASE 6 — the self-healing half of account provisioning.
 *
 * Guarantee: every legitimate Clerk identity has a SESS User row. The webhook
 * (app/api/webhooks/clerk/route.ts) remains the PRIMARY path and is unchanged;
 * this is the safety net for the two cases it structurally cannot cover:
 *
 *   1. a Clerk account that pre-dates the webhook, or was created in the Clerk
 *      dashboard rather than by accepting an invitation — user.created either
 *      never fired for SESS or fired before the handler existed;
 *   2. a delivery that failed or was dropped (already happened once here).
 *
 * Both produced the same dead end: authenticated in Clerk, invisible to SESS,
 * with no recovery except somebody noticing and running a script by hand. This
 * function is called from lib/auth.ts on every authenticated request, so the
 * gap closes by itself the next time the person loads a page.
 *
 * ─── FAIL CLOSED, ALWAYS ─────────────────────────────────────────────────
 * A User row IS an authorization grant, so every ambiguity refuses:
 *   - `role` comes from Clerk's publicMetadata (the same source of truth
 *     middleware.ts and realRoleOf() already use) and is NEVER defaulted. No
 *     role, or an unrecognised one, creates NOTHING. In particular there is no
 *     "default to EMPLOYEE" here — an unrecognised role means we do not know
 *     who this is, and guessing the bottom of the hierarchy would still mint a
 *     real account for an identity we cannot vouch for.
 *   - no email → refuse, because the Employee match below could not be
 *     attempted, so we cannot tell an administrator apart from staff.
 *   - the address maps to an Employee already owned by another Clerk account →
 *     refuse. Two identities claiming one person is exactly the state a script
 *     must not resolve on its own.
 * Every refusal leaves the caller in the situation it is in today: no User row,
 * therefore no access. Nothing here can ever widen access on failure.
 *
 * ─── EMPLOYEE LINK IS OPTIONAL ───────────────────────────────────────────
 * The Employee match is attempted through linkClerkUserToEmployee() — the same
 * matcher the webhook uses, not a second copy of it — and attached when it
 * hits. When no Employee owns the address, employeeId stays NULL: the correct
 * shape for an administrator with no HR profile (see the User model comment).
 * No Employee record is ever invented.
 *
 * ─── RACE SAFETY ─────────────────────────────────────────────────────────
 * Two simultaneous requests from the same new identity both find no User row
 * and both attempt a create. The authority resolving that is the DATABASE:
 * User.clerkId is @unique, so exactly one INSERT commits and the other fails
 * with P2002. This function catches P2002, re-reads, and reports the winner's
 * row as ALREADY_PROVISIONED. There is no check-then-create window to lose,
 * because the check is not what protects the invariant — the constraint is.
 *
 * Dependency-injected `db` for the same reason as the rest of this module: no
 * db/Clerk import here, so prisma/verify-*.ts can exercise the REAL logic.
 */
export async function ensureUserForClerkIdentity(
  db: PrismaClient,
  args: { clerkId: string; email: string | null; role: Role | null; source?: string },
): Promise<EnsureUserResult> {
  if (!args.role)
    return {
      created: false,
      code: "NO_ROLE",
      reason: `no recognised role in Clerk publicMetadata for ${args.clerkId}`,
    };

  const email = args.email?.trim().toLowerCase() || null;
  if (!email)
    return { created: false, code: "NO_EMAIL", reason: `${args.clerkId} has no email address` };

  const source = args.source ?? "self-heal";

  // Attempt the Employee link first: when one matches, the linked row is the
  // right answer and this returns having done the whole job.
  let link: LinkResult;
  try {
    link = await linkClerkUserToEmployee(db, {
      clerkId: args.clerkId,
      email,
      role: args.role,
      source,
    });
  } catch (err) {
    return { created: false, code: await raceOrConflict(err), reason: describe(err) };
  }
  if (link.linked)
    return {
      created: true,
      userId: link.userId,
      employeeId: link.employeeId,
      reason: `linked to employee ${link.employeeId}`,
    };
  if (link.code === "ALREADY_LINKED_CLERK")
    return { created: false, code: "ALREADY_PROVISIONED", reason: link.reason };
  if (link.code === "EMPLOYEE_TAKEN")
    return { created: false, code: "AMBIGUOUS", reason: link.reason };

  // NO_EMPLOYEE_MATCH — the legitimate employee-less account. Create the User
  // with employeeId NULL and audit it in the SAME transaction: an unaudited
  // account appearing in the identity table is precisely what must not happen.
  try {
    const [user] = await db.$transaction([
      db.user.create({ data: { clerkId: args.clerkId, role: args.role, employeeId: null } }),
      db.auditLog.create({
        data: {
          // The account provisions its own application identity; no other party
          // acted. `source` records how the row came to exist.
          actorUserId: args.clerkId,
          action: "USER_SELF_PROVISIONED",
          targetEntity: `clerkId=${args.clerkId} email=${email} role=${args.role} employeeId=null source=${source}`,
        },
      }),
    ]);
    return {
      created: true,
      userId: user.id,
      employeeId: null,
      reason: `no employee matches ${email} — created with employeeId NULL`,
    };
  } catch (err) {
    return { created: false, code: await raceOrConflict(err), reason: describe(err) };
  }

  /**
   * A unique-constraint violation is only benign if it was OUR race: a User row
   * for this exact clerkId now exists. Anything else (an employeeId collision,
   * a genuine fault) stays a refusal rather than being reported as success.
   */
  async function raceOrConflict(err: unknown): Promise<EnsureRefusal> {
    if ((err as { code?: string })?.code !== "P2002") return "CONFLICT";
    const winner = await db.user.findUnique({
      where: { clerkId: args.clerkId },
      select: { id: true },
    });
    return winner ? "ALREADY_PROVISIONED" : "CONFLICT";
  }
  function describe(err: unknown): string {
    return (err as { message?: string })?.message ?? String(err);
  }
}
