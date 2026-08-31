import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { ymd } from "@/lib/reports/range";

/**
 * GREEN TIER — SESS_Caching_Strategy.docx §2/§4.
 * Shift definitions and the holiday calendar: the two pieces of long-lived
 * time/calendar configuration in SESS. Both sit in this file because §9's
 * layout gives no `holidays.ts` and a holiday calendar is the same KIND of
 * data as a shift definition — org-wide, rarely edited, edited only by HR,
 * and always invalidated by name rather than waited out.
 *
 * LEAVE TYPES (§2, §4 GREEN) are NOT here and are not cached: this schema has
 * no leave-type concept at all. LeaveRequest (prisma/schema.prisma:577) is
 * startDate / endDate / reason / status — there is no type column, no
 * LeaveType model and no entitlement table. There is nothing to cache.
 *
 * COMPANY SETTINGS / BRANDING (§2 "Company settings", 15 min–6 hr) are also
 * deliberately absent — see lib/system-settings.ts and the note in
 * lib/invalidation/employee.ts. Every SystemSetting key in this app is an
 * ENFORCEMENT switch, not a display value, so caching them is forbidden by
 * §8. Branding is a static React component (components/brand/logo.tsx), which
 * the build already serves as an immutable static asset — browser/CDN cached
 * per §2 with no application cache involved.
 */

export const TAG_SHIFTS = "shifts";
export const TAG_HOLIDAYS = "holidays";

/** §2: shift definitions — 1–6 hr. */
export const SHIFTS_TTL = 3600;
/** §2: holiday calendar — 6–24 hr. */
export const HOLIDAYS_TTL = 21600;

/**
 * Active shifts for assignment dropdowns — the same select
 * lib/data/scope.ts#getActiveShifts() issues, cached.
 *
 * All four fields are strings, so this survives the Data Cache round-trip
 * unchanged. getActiveShifts() itself is left in place and uncached: it is a
 * general-purpose reader and this is its display-only counterpart.
 */
export const getActiveShiftOptions = unstable_cache(
  async () =>
    db.shift.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, startTime: true, endTime: true },
    }),
  ["shifts:active-options"],
  { tags: [TAG_SHIFTS], revalidate: SHIFTS_TTL },
);

export interface ShiftWithCount {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  gracePeriodMinutes: number;
  active: boolean;
  assignedCount: number;
}

/** Every shift plus how many employees are on it — the /hr/shifts table. */
export const getShiftsWithAssignedCounts = unstable_cache(
  async (): Promise<ShiftWithCount[]> => {
    const rows = await db.shift.findMany({
      include: { _count: { select: { employees: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      startTime: s.startTime,
      endTime: s.endTime,
      gracePeriodMinutes: s.gracePeriodMinutes,
      active: s.active,
      assignedCount: s._count.employees,
    }));
  },
  ["shifts:with-counts"],
  { tags: [TAG_SHIFTS], revalidate: SHIFTS_TTL },
);

export interface CachedHoliday {
  id: string;
  name: string;
  /** "YYYY-MM-DD". A Date does NOT survive the Data Cache — it comes back as a
   *  string — so the date is projected here and parsed back by the caller with
   *  lib/period.ts#parseDateOnly(), which yields the same LOCAL midnight the
   *  rest of the codebase's date handling depends on. */
  date: string;
}

/** The whole calendar, ascending — the /hr/holidays page. */
export const getHolidayCalendar = unstable_cache(
  async (): Promise<CachedHoliday[]> => {
    const rows = await db.holiday.findMany({ orderBy: { date: "asc" } });
    return rows.map((h) => ({ id: h.id, name: h.name, date: ymd(h.date) }));
  },
  ["holidays:all"],
  { tags: [TAG_HOLIDAYS], revalidate: HOLIDAYS_TTL },
);

/**
 * Holidays falling on one day, for the celebratory banner.
 *
 * Keyed by the day string so the cache entry can never outlive the day it
 * describes — the ONE thing a long TTL over a "today" query would otherwise
 * get wrong. This is the highest-traffic reader in lib/cache/: loadToday()
 * runs on all four dashboards plus the community wall.
 */
export function getHolidaysOn(dayYmd: string): Promise<{ id: string; name: string }[]> {
  return unstable_cache(
    async () => {
      const [y, m, d] = dayYmd.split("-").map(Number);
      const start = new Date(y, m - 1, d);
      const end = new Date(y, m - 1, d + 1);
      return db.holiday.findMany({
        where: { date: { gte: start, lt: end } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
    },
    ["holidays:on", dayYmd],
    { tags: [TAG_HOLIDAYS], revalidate: HOLIDAYS_TTL },
  )();
}
