import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import {
  validatePunch,
  isLateCheckIn,
  lateMinutesForShift,
} from "@/lib/attendance/validation";

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

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
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

    // Run validation regardless of punch direction.
    const validation = validatePunch({ ip, lat, long, at: now });
    const flaggedForReview = !validation.passed;
    const reviewReason = flaggedForReview
      ? validation.failures.join("; ")
      : null;

    // Find today's row to decide check-in vs check-out.
    const existing = await db.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: { gte: startOfDay(now), lt: endOfDay(now) },
      },
      orderBy: { date: "desc" },
    });

    let punchType: PunchType;
    let record;

    if (!existing) {
      // First punch of the day → CHECK-IN. A comment is mandatory (enforced
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
      const shift = employee.shiftId
        ? await db.shift.findUnique({ where: { id: employee.shiftId } })
        : null;
      if (shift) {
        lateMinutes = lateMinutesForShift(now, shift.startTime, shift.gracePeriodMinutes);
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
          date: startOfDay(now),
          checkIn: now,
          channel: "WEB",
          ipAddress: ip,
          lat,
          long,
          lateFlag,
          lateMinutes,
          checkInNote: note,
          flaggedForReview,
          reviewReason,
        },
      });
    } else if (existing.checkIn && !existing.checkOut) {
      // Second punch → CHECK-OUT. A failed checkout still flags the row.
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
        },
      });
    } else {
      // Already checked in AND out today — nothing new to record.
      return NextResponse.json({
        ok: true,
        punchType: existing.checkOut ? "OUT" : "IN",
        status: "already_complete" as PunchStatus,
        message: "You have already checked in and out today.",
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
