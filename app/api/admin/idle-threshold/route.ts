import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  IDLE_THRESHOLD_KEY,
  MIN_IDLE_THRESHOLD_SECONDS,
  MAX_IDLE_THRESHOLD_SECONDS,
} from "@/lib/idle/settings";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Set the idle threshold, Super Admin only.
 *
 * Stored in SystemSetting rather than an env var precisely so it can change
 * without a redeploy. Agents pick the new value up from the next heartbeat
 * response — no reinstall, no push mechanism needed.
 */
export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only a Super Admin may change the idle threshold", 403);

  let body: { seconds?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const raw = typeof body.seconds === "number" ? body.seconds : Number(body.seconds);
  const seconds = Math.trunc(raw);
  if (
    !Number.isFinite(seconds) ||
    seconds < MIN_IDLE_THRESHOLD_SECONDS ||
    seconds > MAX_IDLE_THRESHOLD_SECONDS
  )
    return fail(
      "BAD_INPUT",
      `Threshold must be between ${MIN_IDLE_THRESHOLD_SECONDS} and ${MAX_IDLE_THRESHOLD_SECONDS} seconds.`,
      400,
    );

  try {
    await db.$transaction(async (tx) => {
      await tx.systemSetting.upsert({
        where: { key: IDLE_THRESHOLD_KEY },
        update: { value: String(seconds), updatedBy: userId },
        create: { key: IDLE_THRESHOLD_KEY, value: String(seconds), updatedBy: userId },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "IDLE_THRESHOLD_CHANGED",
          targetEntity: `${IDLE_THRESHOLD_KEY}=${seconds}`,
        },
      });
    });

    return NextResponse.json({ ok: true, seconds });
  } catch (err) {
    console.error("[admin/idle-threshold] failed:", err);
    return fail("SERVER_ERROR", "Could not update the threshold", 503);
  }
}
