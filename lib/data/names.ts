import { db } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/auth-types";

/**
 * Display names for Clerk user ids — the ids stored in reviewedBy, actorUserId
 * and similar columns. One query for the whole list. An account with an
 * Employee shows that person's name; one without (e.g. a Super Admin) shows its
 * role. Ids with no SESS account (system actors, deleted users) are left out,
 * so callers fall back to their own placeholder.
 */
export async function namesForClerkIds(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => !!id)));
  if (unique.length === 0) return new Map();
  const users = await db.user.findMany({
    where: { clerkId: { in: unique } },
    select: { clerkId: true, role: true, employee: { select: { name: true } } },
  });
  return new Map(users.map((u) => [u.clerkId, u.employee?.name ?? `${ROLE_LABEL[u.role]} account`]));
}
