import "server-only";
import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import type { Role } from "@/lib/auth-types";
import { ROLE_RANK, coerceRole } from "@/lib/auth-types";
import {
  IMP_COOKIE,
  verifyImpersonation,
  type ImpersonationPayload,
} from "@/lib/impersonation";

/**
 * RED TIER — never cache, see SESS_Caching_Strategy.docx Section 3.
 *
 * PERMISSIONS / ROLE SCOPE and AUTHENTICATION / SESSION STATE. Section 3:
 * "No shared cache" and "Do not build a custom cache"; Section 8: "Do not use
 * cached permissions as the sole authority for security decisions."
 *
 * Every role and identity in SESS is resolved HERE, from the live Clerk
 * session (and, for a Super Admin, a signed impersonation cookie verified on
 * the spot). No role, no permission and no session value is ever read from
 * the Next.js Data Cache, a CDN, Redis or any other shared mechanism — the
 * shared caching layer this app added in lib/cache/ has no reader of any of
 * them, by construction.
 *
 * `cache()` below is React's PER-REQUEST memo — Section 1's "React cache()"
 * layer, whose whole scope is one server render. It is not a shared cache: it
 * holds nothing between requests, is never keyed across users, and cannot
 * serve one caller's identity to another. Section 1 lists it as a caching
 * layer to USE for exactly this, deduplicating repeated work inside a single
 * render, and it is the only "cache" permitted anywhere near an identity.
 *
 * DISPLAY vs AUTHORITY: nothing in this codebase caches a role for display
 * either (there is no cached role badge). If one is ever added, it may only
 * print a label — every real check must keep calling into this file.
 */

async function realRoleOf(
  sessionClaims: { metadata?: { role?: unknown } } | null,
): Promise<Role | null> {
  const fromClaims = coerceRole(sessionClaims?.metadata?.role);
  if (fromClaims) return fromClaims;
  // Fallback for sessions whose token isn't customized yet.
  const user = await currentUser();
  return coerceRole(user?.publicMetadata?.role);
}

export interface Identity {
  realUserId: string | null; // the actual authenticated Clerk user
  realRole: Role | null; // that user's own role
  userId: string | null; // EFFECTIVE identity (impersonated clerkId when impersonating)
  role: Role | null; // EFFECTIVE role
  impersonation: ImpersonationPayload | null;
}

/**
 * The single source of truth for "who is this request acting as".
 *
 * Impersonation is applied ONLY when the REAL authenticated user is a
 * Super Admin AND holds a valid, correctly-bound impersonation cookie.
 * For everyone else the cookie is ignored entirely and the effective identity
 * is just the real identity — so no downstream check can be fooled by a
 * forged/copied cookie. Memoized per request via React cache().
 *
 * ─── ON OFFBOARDED EMPLOYEES ─────────────────────────────────────────────
 * This resolves identity from the Clerk session alone and deliberately does
 * NOT check Employee.active. Offboarded employees intentionally retain login
 * access so they can view/download their own historical payslips and data
 * after leaving — this is a deliberate design decision, not an oversight. See
 * lib/employees/invite.ts and app/employee/profile/actions.ts for the
 * corresponding write-protection guards that still apply to them.
 */
export const resolveIdentity = cache(async (): Promise<Identity> => {
  const { userId: realUserId, sessionClaims } = await auth();
  if (!realUserId) {
    return { realUserId: null, realRole: null, userId: null, role: null, impersonation: null };
  }
  const realRole = await realRoleOf(sessionClaims);

  if (realRole === "SUPER_ADMIN") {
    const token = cookies().get(IMP_COOKIE)?.value;
    const imp = await verifyImpersonation(token, realUserId);
    if (imp) {
      // Act fully as the impersonated identity everywhere downstream.
      return { realUserId, realRole, userId: imp.cid, role: imp.role, impersonation: imp };
    }
  }
  return { realUserId, realRole, userId: realUserId, role: realRole, impersonation: null };
});

/** EFFECTIVE role of the current request (impersonated role when impersonating). */
export async function getCurrentRole(): Promise<Role | null> {
  return (await resolveIdentity()).role;
}

/** EFFECTIVE Clerk id — feed this to getEmployeeByClerkId / actor-id fields. */
export async function getEffectiveUserId(): Promise<string | null> {
  return (await resolveIdentity()).userId;
}

/** The REAL authenticated identity, ignoring impersonation (for the banner + guards). */
export async function getRealIdentity(): Promise<{ realUserId: string | null; realRole: Role | null }> {
  const i = await resolveIdentity();
  return { realUserId: i.realUserId, realRole: i.realRole };
}

/** Active impersonation payload, or null. */
export async function getImpersonation(): Promise<ImpersonationPayload | null> {
  return (await resolveIdentity()).impersonation;
}

/** True when the EFFECTIVE role is at least `min` in the hierarchy. */
export async function hasAtLeastRole(min: Role): Promise<boolean> {
  const role = (await resolveIdentity()).role;
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
