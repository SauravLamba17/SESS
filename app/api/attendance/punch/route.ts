import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import {
  validatePunch,
  isLateCheckIn,
  lateMinutesForShift,
  resolvePunch,
  MAX_OPEN_SHIFT_HOURS,
} from "@/lib/attendance/validation";
import { attendanceValidationMode } from "@/lib/system-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PunchType = "IN" | "OUT";
type PunchStatus = "success" | "late" | "flagged" | "already_complete";

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  // Fallback to the platform-provided connection IP when present.
  return req.ip ?? null;
}

function coerceCoord(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}


export async function POST(req: NextRequest) {
  // ── Auth: resolve the employee from the Clerk session ──────
  const userId = await getEffectiveUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated" },
      { status: 401 },
    );
  }

  // ── Parse body (tolerate empty/invalid JSON) ───────────────
  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const lat = coerceCoord(body.lat);
  const long = coerceCoord(body.long);
  // Parsed through the SAME coercion as lat/long, so a missing, non-numeric or
  // NaN value becomes null rather than reaching the database.
  //
  // Deliberately NOT passed to validatePunch below: accuracy is recorded for a
  // human reviewer to read, never used to judge a punch. No value of it — large,
  // small or null — can flag or reject anything.
  const accuracy = coerceCoord(body.accuracy);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const ip = clientIp(req);
  const now = new Date();

  try {
    const employee = await getEmployeeByClerkId(userId);
    if (!employee) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No employee record is linked to this account. Contact HR to complete onboarding.",
        },
        { status: 409 },
      );
    }

    // Run validation regardless of punch direction. Mode is DB-backed since
    // Phase 11 (Super Admin adjusts it on /admin/modules; env var is the
    // default) — a failed mode read falls back rather than dropping the punch.
    const validation = validatePunch({ ip, lat, long, at: now }, await attendanceValidationMode());
    const flaggedForReview = !validation.passed;
    const reviewReason = flaggedForReview
      ? validation.failures.join("; ")
      : null;

    // The employee's shift decides both lateness and which calendar day this
    // punch belongs to, so it is resolved once, up front.
    const shift = employee.shiftId
      ? await db.shift.findUnique({ where: { id: employee.shiftId } })
      : null;

    /**
     * Decide check-in vs check-out from the most recent OPEN row rather than
     * from "a row dated today".
     *
     * The old date-keyed lookup could not see the night shift's open row once
     * the clock passed midnight: an 18:00–03:00 worker punching out at 03:05
     * was given a brand-new check-in row on the next day, leaving the real
     * shift permanently open and un-closeable. Keying on the open row makes
     * both shifts behave identically — the day shift's 17:00 punch and the
     * night shift's 03:05 punch each simply close what is open.
     */
    const openSince = new Date(now.getTime() - MAX_OPEN_SHIFT_HOURS * 3_600_000);
    const recentRow = await db.attendance.findFirst({
      where: { employeeId: employee.id, checkIn: { not: null, gte: openSince } },
      orderBy: { checkIn: "desc" },
    });

    const decision = resolvePunch({ at: now, shift, recentRow });

    let punchType: PunchType;
    let record;

    if (decision.action === "CHECK_IN") {
      // First punch of the shift → CHECK-IN. A comment is mandatory (enforced
      // server-side, not just in the modal).
      if (!note) {
        return NextResponse.json(
          {
            ok: false,
            code: "NOTE_REQUIRED",
            error: "A comment is required to clock in.",
          },
          { status: 400 },
        );
      }
      punchType = "IN";
      // Shift-based lateness (Phase 6/7). Fall back to the WORKDAY_START env
      // behaviour if the employee somehow has no assigned shift — in that case
      // lateMinutes stays null (we have no shift start to measure against).
      let lateFlag: boolean;
      let lateMinutes: number | null = null;
      if (shift) {
        // endTime is passed so an after-midnight arrival on the night shift is
        // measured against the previous evening's start, not called on time.
        lateMinutes = lateMinutesForShift(
          now,
          shift.startTime,
          shift.gracePeriodMinutes,
          shift.endTime,
        );
        lateFlag = lateMinutes !== null;
      } else {
        console.warn(
          `[attendance/punch] employee ${employee.id} has no shift; falling back to WORKDAY_START lateness (lateMinutes stays null).`,
        );
        lateFlag = isLateCheckIn(now);
        lateMinutes = null;
      }
      record = await db.attendance.create({
        data: {
          employeeId: employee.id,
          // THE SHIFT'S START DATE, not the punch's own date. For the night
          // shift this keeps the whole 18:00→03:00 span on the day it began.
          date: decision.shiftDate,
          checkIn: now,
          channel: "WEB",
          ipAddress: ip,
          lat,
          long,
          accuracy,
          lateFlag,
          lateMinutes,
          checkInNote: note,
          flaggedForReview,
          reviewReason,
        },
      });
    } else if (decision.action === "CHECK_OUT") {
      // Second punch → CHECK-OUT. Closes the open row whatever calendar day it
      // started on, which is what makes the night shift work. A failed
      // checkout still flags the row.
      const existing = recentRow!;
      punchType = "OUT";
      record = await db.attendance.update({
        where: { id: existing.id },
        data: {
          checkOut: now,
          // Preserve any earlier flag; add this punch's failure if present.
          flaggedForReview: existing.flaggedForReview || flaggedForReview,
          reviewReason:
            [existing.reviewReason, reviewReason].filter(Boolean).join("; ") ||
            null,
          // Only overwrite IP/geo if we now have them (checkout may add geo).
          ipAddress: existing.ipAddress ?? ip,
          lat: existing.lat ?? lat,
          long: existing.long ?? long,
          // Same back-fill rule as lat/long: keep the check-in's reading, but
          // adopt the check-out's if the check-in never got one.
          accuracy: existing.accuracy ?? accuracy,
        },
      });
    } else {
      // Already checked in AND out for this shift — nothing new to record.
      const existing = recentRow!;
      return NextResponse.json({
        ok: true,
        punchType: existing.checkOut ? "OUT" : "IN",
        status: "already_complete" as PunchStatus,
        message: "You have already checked in and out for this shift.",
        attendanceId: existing.id,
        checkIn: existing.checkIn,
        checkOut: existing.checkOut,
        lateFlag: existing.lateFlag,
        flaggedForReview: existing.flaggedForReview,
        reason: existing.reviewReason,
      });
    }

    // Derive the user-facing status.
    let status: PunchStatus;
    if (flaggedForReview) status = "flagged";
    else if (punchType === "IN" && record.lateFlag) status = "late";
    else status = "success";

    return NextResponse.json({
      ok: true,
      punchType,
      status,
      reason: reviewReason,
      checksRun: validation.checksRun,
      attendanceId: record.id,
      checkIn: record.checkIn,
      checkOut: record.checkOut,
      lateFlag: record.lateFlag,
      lateMinutes: record.lateMinutes,
      flaggedForReview: record.flaggedForReview,
    });
  } catch (err) {
    // Never surface a raw stack; give a clear, actionable message.
    console.error("[attendance/punch] failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error:
          "Could not record the punch — the attendance database is unavailable. Please try again or contact HR.",
      },
      { status: 503 },
    );
  }
}
