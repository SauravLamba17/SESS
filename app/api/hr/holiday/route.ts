import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseDateOnly } from "@/lib/period";
import { fail } from "@/lib/api/response";
import { onHolidayCalendarChanged } from "@/lib/invalidation/employee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Add or remove a holiday.
 *
 * One row per actual calendar date — no recurrence rule. Indian festival dates
 * move against the Gregorian calendar every year, so HR enters each year's
 * real dates rather than the system guessing and being confidently wrong.
 */
export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may manage the holiday calendar", 403);

  let body: { action?: unknown; id?: unknown; name?: unknown; date?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const action = typeof body.action === "string" ? body.action : "add";

  try {
    if (action === "remove") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return fail("BAD_INPUT", "id is required", 400);

      const holiday = await db.holiday.findUnique({
        where: { id },
        select: { id: true, name: true },
      });
      if (!holiday) return fail("NOT_FOUND", "Holiday not found", 404);

      await db.$transaction(async (tx) => {
        await tx.holiday.delete({ where: { id } });
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: "HOLIDAY_REMOVED",
            targetEntity: `${id} (${holiday.name})`,
          },
        });
      });

      // §5: invalidate immediately after the successful write.
      onHolidayCalendarChanged();

      return NextResponse.json({ ok: true, id });
    }

    // ── add ──
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const dateStr = typeof body.date === "string" ? body.date.trim() : "";
    if (!name || name.length > 120)
      return fail("BAD_INPUT", "A holiday name is required (under 120 characters)", 400);
    const date = parseDateOnly(dateStr);
    if (!date)
      return fail("BAD_INPUT", "date must be a valid YYYY-MM-DD calendar date", 400);

    // Same name on the same day is a duplicate entry, not a second holiday.
    const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    const dupe = await db.holiday.findFirst({
      where: { name, date: { gte: date, lt: dayEnd } },
      select: { id: true },
    });
    if (dupe)
      return fail("DUPLICATE", `“${name}” is already on the calendar for ${dateStr}.`, 409);

    const created = await db.$transaction(async (tx) => {
      const h = await tx.holiday.create({ data: { name, date, createdBy: userId } });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "HOLIDAY_ADDED",
          targetEntity: `${h.id} (${name} on ${dateStr})`,
        },
      });
      return h;
    });

    // §5: invalidate immediately after the successful write.
    onHolidayCalendarChanged();

    return NextResponse.json({ ok: true, id: created.id });
  } catch (err) {
    console.error("[hr/holiday] failed:", err);
    return fail("SERVER_ERROR", "Could not update the holiday calendar", 503);
  }
}
