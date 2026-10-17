import "server-only";
import { db } from "@/lib/db";
import { getHolidaysOn } from "@/lib/cache/shifts";
import { ymd } from "@/lib/reports/range";
import { startOfDay } from "@/lib/period";
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
 * ONE call, TWO queries in parallel (roster + presence in one statement, and
 * the cached holiday calendar) — used identically by all four
 * dashboards. Without it, the same three widgets across four portals would
 * mean twelve query paths to keep consistent.
 *
 * SCOPE DISCIPLINE (Phase 9's one principle):
 * The presence statement returns two booleans per person and nothing else
 * from Attendance or LeaveRequest. lateFlag, lateMinutes,
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

export async function loadToday(now = new Date()): Promise<TodayData> {
  const dayStart = startOfDay(now);
  const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);

  const [employees, holidays] = await Promise.all([
    // The active roster with today's presence, in ONE statement (it was three:
    // roster, attendance, leave). PRESENCE ONLY — each person carries two
    // booleans and nothing else from Attendance, so no punctuality signal is
    // ever fetched. Leave is approved leave overlapping today, half-open on
    // endDate so a leave ending today still counts as on-leave today.
    db.$queryRaw<
      { id: string; name: string; department: string; dateOfBirth: Date | null; present: boolean; onLeave: boolean }[]
    >`
      SELECT e.id, e.name, e.department, e."dateOfBirth",
        EXISTS (SELECT 1 FROM "Attendance" a
                WHERE a."employeeId" = e.id AND a.date >= ${dayStart} AND a.date < ${dayEnd}
                  AND a."checkIn" IS NOT NULL) AS present,
        EXISTS (SELECT 1 FROM "LeaveRequest" l
                WHERE l."employeeId" = e.id AND l.status = 'APPROVED'
                  AND l."startDate" < ${dayEnd} AND l."endDate" >= ${dayStart}) AS "onLeave"
      FROM "Employee" e
      WHERE e.active
      ORDER BY e.department ASC, e.name ASC`,

    // GREEN TIER (SESS_Caching_Strategy.docx §2/§4) — holiday calendar, 6 hr,
    // keyed on the day so an entry can never outlive the day it describes and
    // dropped by tag whenever HR edits the calendar.
    //
    // This is the highest-traffic cached read in SESS: loadToday() runs on all
    // four dashboards and the community wall, so this one query was being
    // issued on essentially every page view by every user, all day, to return
    // the same (almost always empty) result.
    //
    // The other three queries here stay uncached on purpose — they are today's
    // presence, which is the whole point of a "who is in today" widget.
    getHolidaysOn(ymd(dayStart)),
  ]);

  const presence = derivePresence(
    employees,
    new Set(employees.filter((e) => e.present).map((e) => e.id)),
    new Set(employees.filter((e) => e.onLeave).map((e) => e.id)),
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
