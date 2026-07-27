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

// ─── THE RESOLVER ──────────────────────────────────────────────────────────

export interface MfaFactors {
  totp: boolean;
  backupCode: boolean;
}

export interface MfaStatus {
  /** The REAL signed-in user's role — never the impersonated one. */
  realRole: Role | null;
  required: boolean;
  enabled: boolean;
  /** True when the user may proceed: either MFA isn't required, or it is on. */
  satisfied: boolean;
  /** Which factors are on, for the setup page's status display. */
  factors: MfaFactors;
}

/** The subset of Clerk's backend User this rule actually reads. */
export interface MfaUserFacts {
  twoFactorEnabled: boolean;
  totpEnabled: boolean;
  backupCodeEnabled: boolean;
}

const NO_FACTORS: MfaFactors = { totp: false, backupCode: false };

function notRequired(realRole: Role | null): MfaStatus {
  return { realRole, required: false, enabled: false, satisfied: true, factors: NO_FACTORS };
}

/**
 * THE WHOLE MFA DECISION, in evaluation order, with every side-effecting
 * dependency injected so a plain-Node script can drive it — including counting
 * how many times the Clerk call was made.
 *
 * ─── ORDER IS THE POINT ───────────────────────────────────────────────────
 * 1. The enforcement TOGGLE, first, before anything else. When it is off (the
 *    default) this returns "not required" for every role and `fetchUserFacts`
 *    is never invoked — so the feature costs one indexed SystemSetting read and
 *    ZERO Clerk Backend API calls, app-wide. Not "returns false eventually":
 *    the expensive dependency is never reached.
 *
 * 2. The ROLE rule. Manager/Employee exit here, as they always did, again
 *    without a Clerk call.
 *
 * 3. Only for a role that requires MFA, with enforcement on, does the Clerk
 *    lookup happen.
 *
 * `realRole` is resolved even on the toggle-off path because /mfa-required
 * needs it to redirect the user home. That is the request's already-memoized
 * session identity, not a second network call.
 *
 * FAIL CLOSED on a thrown `fetchUserFacts`: we cannot prove a second factor is
 * on, and this gate protects payroll and personal data, so the answer is "not
 * satisfied". The toggle read fails closed independently — see
 * lib/system-settings.ts's mfaEnforcementEnabled().
 */
export async function resolveMfaStatus(deps: {
  enforcementEnabled: () => Promise<boolean>;
  realRole: () => Promise<Role | null>;
  fetchUserFacts: () => Promise<MfaUserFacts | null>;
  onError?: (err: unknown) => void;
}): Promise<MfaStatus> {
  if (!(await deps.enforcementEnabled())) return notRequired(await deps.realRole());

  const realRole = await deps.realRole();
  if (!roleRequiresMfa(realRole)) return notRequired(realRole);

  try {
    const facts = await deps.fetchUserFacts();
    const enabled = facts?.twoFactorEnabled === true;
    return {
      realRole,
      required: true,
      enabled,
      satisfied: enabled,
      factors: {
        totp: facts?.totpEnabled === true,
        backupCode: facts?.backupCodeEnabled === true,
      },
    };
  } catch (err) {
    deps.onError?.(err);
    return { realRole, required: true, enabled: false, satisfied: false, factors: NO_FACTORS };
  }
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
