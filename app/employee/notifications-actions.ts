"use server";

import { revalidatePath } from "next/cache";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";

/**
 * Mark the signed-in employee's own notifications read.
 *
 * The employeeId comes from the session, never from the client, and it is part
 * of the updateMany where-clause — so a caller passing someone else's
 * notification ids simply matches zero rows.
 */
export async function markNotificationsRead(
  ids: string[],
): Promise<{ ok: boolean; error?: string; updated?: number }> {
  const userId = await getEffectiveUserId();
  if (!userId) return { ok: false, error: "You must be signed in." };

  const clean = Array.isArray(ids) ? ids.filter((i) => typeof i === "string" && i) : [];
  if (clean.length === 0) return { ok: true, updated: 0 };

  try {
    const employee = await getEmployeeByClerkId(userId);
    if (!employee) return { ok: false, error: "No employee record linked to your account." };

    const upd = await db.notification.updateMany({
      where: { id: { in: clean }, employeeId: employee.id, read: false },
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
