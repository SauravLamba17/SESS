import "server-only";
import { db } from "@/lib/db";

/**
 * A signed-in account's most recent notifications — unread first, then newest —
 * serialised for the client panel. Shared by the HR and Employee dashboards.
 *
 * ONE statement: the recipient is matched through the User relation by Clerk
 * id, rather than resolving the User first and then querying by its id (two
 * round trips for the same rows). Addressed by USER, never by Employee, so an
 * account with no Employee record (a Super Admin) still sees its own alerts.
 *
 * RED TIER — never cached. The scope predicate is the caller's own identity.
 */
export async function loadRecentNotifications(clerkId: string, take: number) {
  const rows = await db.notification.findMany({
    where: { recipient: { is: { clerkId } } },
    orderBy: [{ read: "asc" }, { createdAt: "desc" }],
    take,
  });
  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    message: n.message,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
  }));
}
