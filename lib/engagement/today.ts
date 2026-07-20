import "server-only";
import { db } from "@/lib/db";
import {
  derivePresence,
  presenceCounts,
  matchBirthdays,
  type PresenceRow,
  type PresenceStatus,
} from "./logic";

export type { PresenceRow, PresenceStatus };

/**
 * The shared "today" data for the three engagement widgets.
 *
 * ONE call, FOUR queries in parallel — used identically by all four
 * dashboards. Without it, the same three widgets across four portals would
 * mean twelve query paths to keep consistent.
 *
 * SCOPE DISCIPLINE (Phase 9's one principle):
 * The presence query selects ONLY `employeeId`. lateFlag, lateMinutes,
 * checkIn, checkOut and checkInNote are never requested, so no punctuality
 * signal exists in this data at any point — there is nothing for the UI to
 * accidentally render. The derivation itself (lib/engagement/logic.ts) takes
 * sets of ids, so it could not receive a late flag even if one were fetched.
 */

export interface TodayData {
  presence: PresenceRow[];
  counts: { in: number; onLeave: number; notMarked: number; total: number };
  birthdays: { id: string; name: string; department: string }[];
  holidays: { id: string; name: string }[];
  today: Date;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export async function loadToday(now = new Date()): Promise<TodayData> {
  const dayStart = startOfDay(now);
  const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);

  const [employees, attendance, leaves, holidays] = await Promise.all([
    db.employee.findMany({
      where: { active: true },
      select: { id: true, name: true, department: true, dateOfBirth: true },
      orderBy: [{ department: "asc" }, { name: "asc" }],
    }),

    // PRESENCE ONLY — `employeeId` is the entire select.
    db.attendance.findMany({
      where: { date: { gte: dayStart, lt: dayEnd }, checkIn: { not: null } },
      select: { employeeId: true },
    }),

    // Approved leave overlapping today. Half-open on endDate so a leave
    // ending today still counts as on-leave today.
    db.leaveRequest.findMany({
      where: {
        status: "APPROVED",
        startDate: { lt: dayEnd },
        endDate: { gte: dayStart },
      },
      select: { employeeId: true },
    }),

    db.holiday.findMany({
      where: { date: { gte: dayStart, lt: dayEnd } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const presence = derivePresence(
    employees,
    new Set(attendance.map((a) => a.employeeId)),
    new Set(leaves.map((l) => l.employeeId)),
  );

  return {
    presence,
    counts: presenceCounts(presence),
    // Month+day match done in JS: the active roster is already in memory from
    // query 1, so it costs nothing, and EXTRACT-style SQL predicates are
    // non-portable and unindexable anyway.
    birthdays: matchBirthdays(employees, now),
    holidays,
    today: dayStart,
  };
}
