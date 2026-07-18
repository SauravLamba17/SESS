import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import type { Role } from "@/lib/auth-types";
import { ROLE_RANK } from "@/lib/auth-types";

function coerceRole(value: unknown): Role | null {
  if (
    value === "EMPLOYEE" ||
    value === "MANAGER" ||
    value === "HR" ||
    value === "SUPER_ADMIN"
  ) {
    return value;
  }
  return null;
}

/**
 * Read the current user's role from the Clerk session.
 *
 * Fast path: the role is embedded in the session token claims under
 * `metadata.role` (configure the Clerk session token to expose
 * `{{user.public_metadata}}` as `metadata` — see README).
 * Fallback: fetch the full user and read `publicMetadata.role`.
 *
 * Returns null when signed out or when no role is set.
 */
export async function getCurrentRole(): Promise<Role | null> {
  const { sessionClaims, userId } = await auth();
  if (!userId) return null;

  const fromClaims = coerceRole(sessionClaims?.metadata?.role);
  if (fromClaims) return fromClaims;

  // Fallback for sessions whose token isn't customized yet.
  const user = await currentUser();
  return coerceRole(user?.publicMetadata?.role);
}

/** True when the signed-in user's role is at least `min` in the hierarchy. */
export async function hasAtLeastRole(min: Role): Promise<boolean> {
  const role = await getCurrentRole();
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** The signed-in Clerk user id, or null. */
export async function getUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}
