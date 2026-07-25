// The MFA POLICY — pure, no imports beyond a type.
//
// Split out of lib/mfa.ts for the same reason lib/employees/invite.ts is split
// from invite-clerk.ts and lib/admin/user-role.ts from admin/clerk.ts: the rule
// that decides who is blocked must be exercisable by a plain-Node verification
// script, and lib/mfa.ts pulls in @clerk/nextjs and next/headers, neither of
// which loads outside the Next runtime.
//
// lib/mfa.ts is this rule fed by Clerk. Nothing else decides MFA access.

import type { Role } from "@/lib/auth-types";

/**
 * Roles whose access to payroll, salary structures and organisation-wide
 * personal data justifies a mandatory second factor.
 *
 * Manager and Employee are deliberately absent: a manager sees their own team
 * and an employee sees themselves, and forcing MFA on the shop floor would
 * mostly produce lockouts, not security.
 */
export const ROLES_REQUIRING_MFA: Role[] = ["HR", "SUPER_ADMIN"];

export function roleRequiresMfa(role: Role | null): boolean {
  return role !== null && ROLES_REQUIRING_MFA.includes(role);
}

/**
 * THE DECISION: should this user be sent to the MFA setup page?
 *
 * True only when the role requires a second factor and the account does not
 * have one. A null role is NOT gated here — an unauthenticated request is
 * sign-in's problem, and returning true would bounce signed-out users into a
 * page that itself requires a session.
 */
export function mfaRedirectRequired(role: Role | null, twoFactorEnabled: boolean): boolean {
  return roleRequiresMfa(role) && !twoFactorEnabled;
}

/**
 * THE API GATE DECISION, kept pure for the same reason as everything else in
 * this file: lib/mfa-guard.ts is the thin adapter that turns this into an
 * HTTP response, and the interesting part — when to block, with what code and
 * status — is testable without Next, Clerk or a request.
 *
 * Blocks on exactly ONE condition: the role requires a second factor and it is
 * not enabled. Everything else allows, so the wrapped handler produces its own
 * 401/403/400/409 exactly as before.
 */
export type MfaGateOutcome =
  | { allow: true }
  | { allow: false; code: "MFA_REQUIRED"; error: string; status: 403 };

export const MFA_REQUIRED_MESSAGE =
  "Two-factor authentication must be enabled on your account before you can use this action. Visit /mfa-required to set it up.";

export function mfaGateOutcome(status: {
  required: boolean;
  satisfied: boolean;
}): MfaGateOutcome {
  if (status.required && !status.satisfied) {
    return {
      allow: false,
      code: "MFA_REQUIRED",
      error: MFA_REQUIRED_MESSAGE,
      status: 403,
    };
  }
  return { allow: true };
}
