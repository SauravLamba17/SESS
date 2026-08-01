import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { withPrivilegedRoute } from "@/lib/mfa-guard";
import { lateMinutesForShift } from "@/lib/attendance/validation";
import { fail } from "@/lib/api/response";
import { ymd } from "@/lib/reports/range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "HH:MM" applied to an existing day, preserving that day's date. */
function timeOnDay(day: Date, hhmm: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, min, 0, 0);
}

function iso(d: Date | null): string {
  return d ? d.toISOString() : "none";
}

/**
 * HR correction of an attendance record.
 *
 * Manually rewriting someone's clock times is exactly the action that needs a
 * permanent trail, so a written reason is mandatory and the audit row carries
 * BOTH the old and the new values — the corrected row itself no longer holds
 * what it used to say, making the audit entry the only surviving evidence of
 * what changed.
 *
 * ── NIGHT SHIFT ──────────────────────────────────────────────────────────
 * checkOut is applied to the row's own date by default, but an 18:00–03:00
 * shift's check-out legitimately falls on the NEXT calendar day. When the
 * corrected checkOut would land before the checkIn, it is rolled forward a day
 * rather than rejected — the same "a shift belongs to the day it started" rule
 * the punch route follows.
 */
async function POSTHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may correct attendance records", 403);

  let body: {
    attendanceId?: unknown;
    checkIn?: unknown;
    checkOut?: unknown;
    reason?: unknown;
    clearFlag?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const attendanceId = typeof body.attendanceId === "string" ? body.attendanceId : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const checkInRaw = typeof body.checkIn === "string" ? body.checkIn.trim() : "";
  const checkOutRaw = typeof body.checkOut === "string" ? body.checkOut.trim() : "";
  const clearFlag = body.clearFlag === true;

  if (!attendanceId) return fail("BAD_INPUT", "attendanceId is required", 400);
  if (!reason)
    return fail(
      "BAD_INPUT",
      "A reason is required — manually altering an attendance record must be explained.",
      400,
    );
  if (!checkInRaw && !checkOutRaw && !clearFlag)
    return fail("BAD_INPUT", "Provide a new check-in time, check-out time, or clear the review flag.", 400);

  try {
    const row = await db.attendance.findUnique({
      where: { id: attendanceId },
      select: {
        id: true,
        date: true,
        checkIn: true,
        checkOut: true,
        lateFlag: true,
        lateMinutes: true,
        flaggedForReview: true,
        reviewReason: true,
        employee: {
          select: {
            id: true,
            name: true,
            employeeCode: true,
            shift: { select: { startTime: true, endTime: true, gracePeriodMinutes: true } },
          },
        },
      },
    });
    if (!row) return fail("NOT_FOUND", "Attendance record not found", 404);

    // ── Build the new values ──
    let newCheckIn = row.checkIn;
    if (checkInRaw) {
      const parsed = timeOnDay(row.date, checkInRaw);
      if (!parsed) return fail("BAD_INPUT", "checkIn must be HH:MM", 400);
      newCheckIn = parsed;
    }

    let newCheckOut = row.checkOut;
    if (checkOutRaw) {
      const parsed = timeOnDay(row.date, checkOutRaw);
      if (!parsed) return fail("BAD_INPUT", "checkOut must be HH:MM", 400);
      newCheckOut = parsed;
    }

    // Overnight roll-forward, then a hard ordering check.
    if (newCheckIn && newCheckOut && newCheckOut <= newCheckIn) {
      newCheckOut = new Date(newCheckOut.getTime() + 24 * 60 * 60 * 1000);
    }
    if (newCheckIn && newCheckOut && newCheckOut <= newCheckIn)
      return fail(
        "BAD_INPUT",
        "Check-out must be after check-in, even allowing for an overnight shift.",
        400,
      );
    if (!newCheckIn && newCheckOut)
      return fail(
        "BAD_INPUT",
        "A record cannot have a check-out without a check-in. Set the check-in time as well.",
        400,
      );

    // Lateness is DERIVED, never typed in — recompute it from the corrected
    // check-in against the employee's shift so the flag cannot drift from the
    // time it describes.
    let lateMinutes = row.lateMinutes;
    let lateFlag = row.lateFlag;
    if (newCheckIn && row.employee.shift) {
      lateMinutes = lateMinutesForShift(
        newCheckIn,
        row.employee.shift.startTime,
        row.employee.shift.gracePeriodMinutes,
        row.employee.shift.endTime,
      );
      lateFlag = lateMinutes !== null;
    }

    const updated = await db.$transaction(async (tx) => {
      const u = await tx.attendance.update({
        where: { id: attendanceId },
        data: {
          checkIn: newCheckIn,
          checkOut: newCheckOut,
          lateFlag,
          lateMinutes,
          ...(clearFlag
            ? {
                flaggedForReview: false,
                reviewReason: row.reviewReason
                  ? `${row.reviewReason} | resolved by HR: ${reason}`
                  : `resolved by HR: ${reason}`,
              }
            : {}),
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "ATTENDANCE_MANUALLY_CORRECTED",
          // OLD → NEW for every field touched. The row itself no longer holds
          // the previous values, so this line is the only record of them.
          targetEntity:
            `attendance=${attendanceId} employee=${row.employee.employeeCode} ` +
            `date=${ymd(row.date)} ` +
            `checkIn: ${iso(row.checkIn)} → ${iso(newCheckIn)} | ` +
            `checkOut: ${iso(row.checkOut)} → ${iso(newCheckOut)} | ` +
            `lateMinutes: ${row.lateMinutes ?? "none"} → ${lateMinutes ?? "none"} | ` +
            `flaggedForReview: ${row.flaggedForReview} → ${clearFlag ? false : row.flaggedForReview}` +
            ` — ${reason}`,
        },
      });

      return u;
    });

    return NextResponse.json({
      ok: true,
      attendanceId,
      checkIn: updated.checkIn,
      checkOut: updated.checkOut,
      lateFlag: updated.lateFlag,
      lateMinutes: updated.lateMinutes,
      flaggedForReview: updated.flaggedForReview,
    });
  } catch (err) {
    console.error("[hr/attendance/correct] failed:", err);
    return fail("SERVER_ERROR", "Could not correct the attendance record", 503);
  }
}

// MFA gate — see lib/mfa-guard.ts. Rejects only when the caller's role
// requires two-factor auth and it is not enabled; every other status this
// route returns is produced by the handler above, unchanged.
export const POST = withPrivilegedRoute(POSTHandler);
