"use server";

import { revalidatePath } from "next/cache";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getUserByClerkId } from "@/lib/data/scope";

/**
 * Mark the signed-in user's own notifications read.
 *
 * The recipient id comes from the session, never from the client, and it is
 * part of the updateMany where-clause — so a caller passing someone else's
 * notification ids simply matches zero rows.
 *
 * Scoped by recipientUserId, not employeeId: the recipient of a notification is
 * an application User. Keying on Employee made this unusable for anyone without
 * an HR profile — an employee-less administrator could see nothing to mark and
 * got "No employee record linked to your account" instead.
 */
export async function markNotificationsRead(
  ids: string[],
): Promise<{ ok: boolean; error?: string; updated?: number }> {
  const userId = await getEffectiveUserId();
  if (!userId) return { ok: false, error: "You must be signed in." };

  const clean = Array.isArray(ids) ? ids.filter((i) => typeof i === "string" && i) : [];
  if (clean.length === 0) return { ok: true, updated: 0 };

  try {
    const me = await getUserByClerkId(userId);
    if (!me) return { ok: false, error: "No SESS account is linked to your login." };

    const upd = await db.notification.updateMany({
      where: { id: { in: clean }, recipientUserId: me.id, read: false },
      data: { read: true },
    });

    // The same panel renders on both dashboards, so both are revalidated.
    revalidatePath("/employee");
    revalidatePath("/hr");
    return { ok: true, updated: upd.count };
  } catch (err) {
    console.error("[markNotificationsRead] failed:", err);
    return { ok: false, error: "Could not update notifications right now." };
  }
}
