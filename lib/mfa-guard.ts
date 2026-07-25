import "server-only";
import { NextResponse } from "next/server";
import { mfaStatus } from "@/lib/mfa";
import { mfaGateOutcome } from "@/lib/mfa-policy";

/**
 * MFA gate for privileged API route handlers.
 *
 * The portal LAYOUTS already redirect an HR or Super Admin without a second
 * factor to /mfa-required, which covers the entire UI. It does not cover the
 * API: a route handler is reachable with nothing but a session cookie and
 * never renders a layout, so a stolen password could still drive
 * /api/hr/payroll/run directly. This closes that gap on every privileged
 * route.
 *
 * ─── COST, and why the ordering matters ──────────────────────────────────
 * The role check comes FIRST and is free — it reads the already-memoized
 * identity. Only when the role is one that actually requires MFA does
 * lib/mfa.ts reach Clerk for `twoFactorEnabled`, and Clerk dedupes that fetch
 * per request. So an EMPLOYEE or MANAGER request pays nothing at all, and an
 * HR request pays at most one Clerk call that a layout render would have made
 * anyway.
 *
 * ─── WHAT THIS WRAPPER DOES NOT DO ───────────────────────────────────────
 * It returns 403 for exactly one condition: the caller's role requires MFA and
 * MFA is not enabled. Every other outcome — 401 for signed-out, 403 for wrong
 * role, 400 for bad input, 409 for a conflict — is produced by the handler
 * itself, untouched. In particular an UNAUTHENTICATED request has no role, so
 * `roleRequiresMfa(null)` is false, the wrapper passes straight through, and
 * the handler still answers its own 401. The wrapper never masks an existing
 * status code.
 *
 * The rule for WHICH roles require MFA is not restated here — it lives once in
 * lib/mfa-policy.ts and reaches this file through lib/mfa.ts.
 */

/** Same { error, code } shape every other route in this codebase returns. */
function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

/**
 * Wrap a route handler so it only runs once the MFA requirement is satisfied.
 *
 * Generic over the trailing arguments so it fits both plain handlers and
 * dynamic-segment ones such as `(req, { params })`.
 */
export function withPrivilegedRoute<Req, Args extends unknown[], Res extends Response>(
  handler: (req: Req, ...args: Args) => Res | Promise<Res>,
): (req: Req, ...args: Args) => Promise<Response> {
  return async (req: Req, ...args: Args): Promise<Response> => {
    let status;
    try {
      status = await mfaStatus();
    } catch (err) {
      // mfaStatus() already fails closed on a Clerk outage (it returns
      // satisfied: false). Reaching here means something more basic broke —
      // the request identity could not be resolved at all. Fail closed too,
      // but say so honestly rather than blaming MFA.
      console.error("[mfa-guard] could not evaluate MFA status:", err);
      return fail(
        "MFA_CHECK_FAILED",
        "Could not verify your account's security status. Please try again.",
        503,
      );
    }

    // The decision itself is pure and lives in lib/mfa-policy.ts, alongside
    // the rule for WHICH roles require MFA — so neither is restated here.
    const outcome = mfaGateOutcome(status);
    if (!outcome.allow) return fail(outcome.code, outcome.error, outcome.status);

    return handler(req, ...args);
  };
}
