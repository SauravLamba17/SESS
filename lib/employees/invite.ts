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

export type CreateInvitationFn = (params: {
  emailAddress: string;
  publicMetadata: { role: Role };
  ignoreExisting: boolean;
}) => Promise<{ id: string }>;

export type InviteResult =
  | { ok: true; invitationId: string }
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
  return { ok: true, invitationId };
}

export type LinkResult =
  | { linked: true; userId: string; employeeId: string }
  | { linked: false; reason: string };

/**
 * Webhook side: correlate a Clerk user.created event to its Employee by email
 * and create the User row (clerkId + role + employeeId) that has been missing
 * since Phase 0. Every non-match is a calm no-op — an uninvited signup is
 * legitimate, not an error.
 */
export async function linkClerkUserToEmployee(
  db: PrismaClient,
  args: { clerkId: string; email: string; role: Role },
): Promise<LinkResult> {
  const email = args.email.trim().toLowerCase();

  // Idempotency: Clerk retries deliver the same event more than once.
  const existing = await db.user.findUnique({
    where: { clerkId: args.clerkId },
    select: { id: true },
  });
  if (existing) return { linked: false, reason: `clerkId ${args.clerkId} is already linked` };

  const emp = await db.employee.findUnique({
    where: { email },
    select: { id: true, user: { select: { id: true } } },
  });
  if (!emp) return { linked: false, reason: `no employee matches email ${email}` };
  if (emp.user)
    return { linked: false, reason: `employee ${emp.id} already has a linked account` };

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
        targetEntity: `employee=${emp.id} clerkId=${args.clerkId} role=${args.role}`,
      },
    }),
  ]);
  return { linked: true, userId: user.id, employeeId: emp.id };
}
