import "server-only";
import { cache } from "react";
import { currentUser } from "@clerk/nextjs/server";
import type { Role } from "@/lib/auth-types";
import { getRealIdentity } from "@/lib/auth";
import { ROLES_REQUIRING_MFA, roleRequiresMfa, mfaRedirectRequired } from "@/lib/mfa-policy";

// Re-exported so callers have one import for the whole concern; the rule
// itself lives in lib/mfa-policy.ts, which has no Clerk dependency.
export { ROLES_REQUIRING_MFA, roleRequiresMfa, mfaRedirectRequired };

/**
 * Role-conditional MFA enforcement.
 *
 * ─── WHAT CLERK ACTUALLY EXPOSES (verified against @clerk/nextjs 6.39.6 /
 *     @clerk/backend 2.33.6, not assumed) ───────────────────────────────────
 *
 *   currentUser()  → Backend `User` with, per
 *                    node_modules/@clerk/backend/dist/api/resources/User.d.ts:
 *                      twoFactorEnabled : boolean   ← what we use
 *                      totpEnabled      : boolean
 *                      backupCodeEnabled: boolean
 *
 *   sessionClaims  → NO MFA field of any kind. The claim set carries the
 *                    customised `metadata.role` this app already relies on,
 *                    but nothing about second factors.
 *
 *   JWT templates  → no `two_factor_enabled` shortcode exists, so the status
 *                    cannot be pushed into the session token either.
 *
 * CONSEQUENCE, and why this is NOT in middleware: `twoFactorEnabled` is only
 * reachable through a Clerk Backend API call. Next 14 middleware runs on the
 * Edge runtime, where that means a network round trip on EVERY request — and
 * Clerk documents currentUser() for Server Components / Route Handlers /
 * Server Actions, not middleware. So the gate lives in the portal LAYOUTS
 * (Node runtime, and Clerk dedupes the fetch per request), which is the
 * fallback the brief anticipated. See the phase report for the residual gap
 * on direct API calls and the recommended follow-up.
 *
 * The check is memoized per request with React cache(), the same pattern
 * lib/auth.ts uses for resolveIdentity().
 */

export interface MfaStatus {
  /** The REAL signed-in user's role — never the impersonated one. */
  realRole: Role | null;
  required: boolean;
  enabled: boolean;
  /** True when the user may proceed: either MFA isn't required, or it is on. */
  satisfied: boolean;
  /** Which factors are on, for the setup page's status display. */
  factors: { totp: boolean; backupCode: boolean };
}

export const mfaStatus = cache(async (): Promise<MfaStatus> => {
  // The REAL identity, deliberately: a Super Admin impersonating an Employee
  // still holds Super Admin credentials, so the requirement follows the real
  // account, not the role currently being viewed.
  const { realRole } = await getRealIdentity();
  const required = roleRequiresMfa(realRole);

  if (!required) {
    return {
      realRole,
      required: false,
      enabled: false,
      satisfied: true,
      factors: { totp: false, backupCode: false },
    };
  }

  try {
    const user = await currentUser();
    const enabled = user?.twoFactorEnabled === true;
    return {
      realRole,
      required: true,
      enabled,
      satisfied: enabled,
      factors: {
        totp: user?.totpEnabled === true,
        backupCode: user?.backupCodeEnabled === true,
      },
    };
  } catch (err) {
    // FAIL CLOSED. If Clerk cannot be reached we cannot prove MFA is on, and
    // this gate protects payroll and personal data — the safe answer to "is
    // this privileged account protected?" is no. The user sees the setup page
    // with a "could not verify" note rather than being silently let through.
    console.error("[mfa] could not read MFA status from Clerk:", err);
    return {
      realRole,
      required: true,
      enabled: false,
      satisfied: false,
      factors: { totp: false, backupCode: false },
    };
  }
});

