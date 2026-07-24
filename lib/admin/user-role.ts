// Same deliberate pattern as lib/employees/invite.ts: NOT `server-only`, no
// db/Clerk imports. The caller supplies the Prisma client and the Clerk
// metadata-update function (the route passes the real one from
// lib/admin/clerk.ts; the verify script passes a stub), so the verification
// script exercises the REAL role-change logic without Next.js or a live key.
import type { PrismaClient } from "@prisma/client";
import type { Role } from "@/lib/auth-types";

export type UpdateClerkRoleFn = (clerkId: string, role: Role) => Promise<void>;

export type RoleChangeResult =
  | { ok: true; oldRole: Role; newRole: Role; clerkSynced: boolean; clerkError?: string }
  | { ok: false; code: "NOT_FOUND" | "LAST_SUPER_ADMIN" | "NO_CHANGE"; message: string };

/**
 * Change a User's role: DATABASE FIRST, then Clerk publicMetadata — in that
 * order, per the phase brief. If the Clerk sync fails after the DB commit the
 * two ARE out of sync; that state is never silent: it is returned to the
 * caller (`clerkSynced: false`), logged, and written to the audit log as
 * USER_ROLE_CLERK_SYNC_FAILED. Retrying is just calling this again with the
 * same role — the DB write is idempotent and Clerk gets another attempt.
 */
export async function changeUserRole(
  db: PrismaClient,
  args: { userId: string; newRole: Role; actorUserId: string },
  updateClerkRole: UpdateClerkRoleFn,
): Promise<RoleChangeResult> {
  const user = await db.user.findUnique({
    where: { id: args.userId },
    select: { id: true, clerkId: true, role: true },
  });
  if (!user) return { ok: false, code: "NOT_FOUND", message: "User not found" };
  const oldRole = user.role as Role;

  // Lockout guard: the system must always keep at least one Super Admin.
  if (oldRole === "SUPER_ADMIN" && args.newRole !== "SUPER_ADMIN") {
    const admins = await db.user.count({ where: { role: "SUPER_ADMIN" } });
    if (admins <= 1)
      return {
        ok: false,
        code: "LAST_SUPER_ADMIN",
        message: "This is the only Super Admin account — demoting it would lock everyone out of administration.",
      };
  }

  // Same role: not an error — treat as a Clerk re-sync request (the retry
  // path after a failed sync) rather than refusing.
  if (oldRole !== args.newRole) {
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { role: args.newRole } }),
      db.auditLog.create({
        data: {
          actorUserId: args.actorUserId,
          action: "USER_ROLE_CHANGED",
          targetEntity: `user=${user.id} clerkId=${user.clerkId} ${oldRole}→${args.newRole}`,
        },
      }),
    ]);
  }

  try {
    await updateClerkRole(user.clerkId, args.newRole);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clerk API call failed";
    console.error(
      `[admin/user-role] DB role updated but Clerk sync FAILED for clerkId=${user.clerkId}: ${message}`,
    );
    await db.auditLog.create({
      data: {
        actorUserId: args.actorUserId,
        action: "USER_ROLE_CLERK_SYNC_FAILED",
        targetEntity: `user=${user.id} clerkId=${user.clerkId} role=${args.newRole}: ${message}`,
      },
    });
    return { ok: true, oldRole, newRole: args.newRole, clerkSynced: false, clerkError: message };
  }

  return { ok: true, oldRole, newRole: args.newRole, clerkSynced: true };
}
