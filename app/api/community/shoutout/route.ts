import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { engagementEnabled } from "@/lib/system-settings";
import { fail } from "@/lib/api/response";
import { DELETE_WINDOW_MINUTES } from "@/lib/engagement/logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Post a shout-out, or delete your own.
 *
 * Open to every role — this is the one genuinely flat surface in the product.
 * No AuditLog by design: a social wall is not a governed action, and Phase 9
 * is deliberately lighter-weight than the rest of the system.
 */
export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);

  // Phase 11: org-wide engagement pause (Module Toggles).
  if (!(await engagementEnabled()))
    return fail("MODULE_DISABLED", "The engagement module is currently paused by the administrator.", 403);

  let body: { action?: unknown; id?: unknown; toEmployeeId?: unknown; message?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  try {
    const me = await getEmployeeByClerkId(userId);
    if (!me)
      return fail(
        "NO_EMPLOYEE",
        "No employee record is linked to your account, so you can't post yet.",
        403,
      );

    // ── Delete own post, within the window ──
    if (body.action === "delete") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return fail("BAD_INPUT", "id is required", 400);

      const cutoff = new Date(Date.now() - DELETE_WINDOW_MINUTES * 60 * 1000);
      // Authorship AND the time window both live in the where-clause, so
      // neither can be bypassed by a crafted request.
      const del = await db.shoutOut.deleteMany({
        where: { id, fromEmployeeId: me.id, createdAt: { gte: cutoff } },
      });
      if (del.count === 0)
        return fail(
          "CANNOT_DELETE",
          `You can only delete your own shout-out, and only within ${DELETE_WINDOW_MINUTES} minutes of posting it.`,
          409,
        );
      return NextResponse.json({ ok: true, id });
    }

    // ── Create ──
    const toEmployeeId = typeof body.toEmployeeId === "string" ? body.toEmployeeId : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!toEmployeeId) return fail("BAD_INPUT", "Choose who this shout-out is for", 400);
    if (!message) return fail("BAD_INPUT", "Write a message", 400);
    if (message.length > 500)
      return fail("BAD_INPUT", "Keep it under 500 characters", 400);
    if (toEmployeeId === me.id)
      return fail("SELF_SHOUTOUT", "Shout-outs are for recognising other people.", 400);

    const recipient = await db.employee.findFirst({
      where: { id: toEmployeeId, active: true },
      select: { id: true },
    });
    if (!recipient)
      return fail("BAD_RECIPIENT", "That person is not an active employee", 400);

    const created = await db.shoutOut.create({
      data: { fromEmployeeId: me.id, toEmployeeId, message },
    });

    return NextResponse.json({ ok: true, id: created.id });
  } catch (err) {
    console.error("[community/shoutout] failed:", err);
    return fail("SERVER_ERROR", "Could not post the shout-out", 503);
  }
}
