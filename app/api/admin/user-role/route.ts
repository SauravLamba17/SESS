import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { changeUserRole } from "@/lib/admin/user-role";
import { clerkUpdateUserRole } from "@/lib/admin/clerk";
import { ROLES, type Role } from "@/lib/auth-types";
import { withPrivilegedRoute } from "@/lib/mfa-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

/**
 * Change an existing User's role, Super Admin only. Creating users is NOT
 * done here — that's the onboarding/invitation flow. Delegates to the shared
 * changeUserRole() (lib/admin/user-role.ts): DB first, then Clerk
 * publicMetadata, with an explicit clerkSynced:false state when the second
 * step fails — never silently out of sync.
 */
async function POSTHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only a Super Admin may change user roles", 403);

  let body: { userId?: unknown; role?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const targetUserId = typeof body.userId === "string" ? body.userId : "";
  const newRole = typeof body.role === "string" ? body.role : "";
  if (!targetUserId || !(ROLES as string[]).includes(newRole))
    return fail("BAD_INPUT", "userId and a valid role are required", 400);

  try {
    const result = await changeUserRole(
      db,
      { userId: targetUserId, newRole: newRole as Role, actorUserId: userId },
      clerkUpdateUserRole,
    );
    if (!result.ok) {
      const status = result.code === "NOT_FOUND" ? 404 : 409;
      return fail(result.code, result.message, status);
    }
    return NextResponse.json({
      ok: true,
      oldRole: result.oldRole,
      newRole: result.newRole,
      clerkSynced: result.clerkSynced,
      ...(result.clerkError ? { clerkError: result.clerkError } : {}),
    });
  } catch (err) {
    console.error("[admin/user-role] failed:", err);
    return fail("SERVER_ERROR", "Could not change the role", 503);
  }
}

// MFA gate — see lib/mfa-guard.ts. Rejects only when the caller's role
// requires two-factor auth and it is not enabled; every other status this
// route returns is produced by the handler above, unchanged.
export const POST = withPrivilegedRoute(POSTHandler);
