import "server-only";
import { db } from "@/lib/db";
import { formatClock } from "@/lib/time-display";

/**
 * "My own attendance today / this week / my shift" — the data behind the
 * clock-in widget's surrounding cards.
 *
 * Extracted from app/employee/page.tsx when the Manager dashboard gained the
 * same widget, so the two portals cannot drift on what "late" or "absent"
 * means. Nothing here is role-aware: it takes an Employee id, and a Manager IS
 * an Employee row (Employee has no role column — role lives on User), so the
 * same call serves both.
 *
 * Returns its three queries from ONE nested Promise.all so a caller can await
 * this inside its own Promise.all and keep everything in a single round trip,
 * which is how both dashboards already batch.
 */

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Re-exported rather than reimplemented: these dashboards render on the SERVER,
 * where an unpinned toLocaleTimeString() formats in the process timezone (UTC
 * on Vercel) and showed every punch 5h30m early. See lib/time-display.ts.
 */
export const fmtTime = formatClock;

/** Monday 00:00 of the current week. */
export function weekStartMonday(now = new Date()): Date {
  const s = startOfDay(now);
  const diffToMon = (s.getDay() + 6) % 7; // 0=Sun..6=Sat -> days since Monday
  s.setDate(s.getDate() - diffToMon);
  return s;
}

export type OwnAttendance = Awaited<ReturnType<typeof loadOwnAttendance>>;

export async function loadOwnAttendance(employeeId: string, shiftId: string | null) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const tomorrowStart = new Date(
    todayStart.getFullYear(),
    todayStart.getMonth(),
    todayStart.getDate() + 1,
  );
  const weekStart = weekStartMonday(now);
  const weekEnd = new Date(
    weekStart.getFullYear(),
    weekStart.getMonth(),
    weekStart.getDate() + 7,
  );

  const [today, weekAtt, shift] = await Promise.all([
    db.attendance.findFirst({
      where: { employeeId, date: { gte: todayStart, lt: tomorrowStart } },
    }),
    db.attendance.findMany({
      where: { employeeId, date: { gte: weekStart, lt: weekEnd } },
    }),
    // Drives what "late" means for THIS person — the same shift the punch
    // route reads when it stamps lateFlag/lateMinutes.
    shiftId ? db.shift.findUnique({ where: { id: shiftId } }) : Promise.resolve(null),
  ]);

  return {
    today,
    shift,
    weekStart,
    weekByDate: new Map(weekAtt.map((a) => [ymd(a.date), a])),
  };
}
