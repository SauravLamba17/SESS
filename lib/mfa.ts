import "server-only";
import { cache } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { getRealIdentity } from "@/lib/auth";
import { mfaEnforcementEnabled } from "@/lib/system-settings";
import {
  ROLES_REQUIRING_MFA,
  roleRequiresMfa,
  mfaRedirectRequired,
  resolveMfaStatus,
  type MfaStatus,
} from "@/lib/mfa-policy";

// Re-exported so callers have one import for the whole concern; the rule
// itself lives in lib/mfa-policy.ts, which has no Clerk dependency.
export { ROLES_REQUIRING_MFA, roleRequiresMfa, mfaRedirectRequired };
export type { MfaStatus };

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

/**
 * The one MFA check in the app. Both portal layout gates, the
 * withPrivilegedRoute wrapper and the reports route call THIS — the
 * enforcement toggle is honoured in exactly one place (the resolver in
 * lib/mfa-policy.ts) and is deliberately not re-checked by any caller.
 *
 * Memoized per request with React cache(), so a layout render and a route
 * handler in the same request share one toggle read and at most one Clerk call.
 */
export const mfaStatus = cache(
  (): Promise<MfaStatus> =>
    resolveMfaStatus({
      // FIRST. When this is false nothing below runs — see lib/mfa-policy.ts.
      enforcementEnabled: mfaEnforcementEnabled,
      // The REAL identity, deliberately: a Super Admin impersonating an
      // Employee still holds Super Admin credentials, so the requirement
      // follows the real account, not the role currently being viewed.
      realRole: async () => (await getRealIdentity()).realRole,
      // The only Clerk Backend API call in this feature. Unreached whenever
      // enforcement is off or the role does not require a second factor.
      fetchUserFacts: async () => {
        const user = await currentUser();
        return user
          ? {
              twoFactorEnabled: user.twoFactorEnabled === true,
              totpEnabled: user.totpEnabled === true,
              backupCodeEnabled: user.backupCodeEnabled === true,
            }
          : null;
      },
      onError: (err) =>
        console.error("[mfa] could not read MFA status from Clerk:", err),
    }),
);

