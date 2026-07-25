/**
 * STEP 1 AUDIT — does the company's real 18:00–03:00 night shift work today?
 *
 * This script does NOT test the fixed code. It replicates the punch route's
 * CURRENT row-resolution logic verbatim (app/api/attendance/punch/route.ts,
 * the startOfDay/endOfDay findFirst) and drives the real scenario through it:
 *
 *     day 1 18:10  check in
 *     day 2 03:05  check out
 *
 * against a real Shift row with startTime "18:00" / endTime "03:00", plus the
 * real 09:00–17:00 day shift as the control. Everything else — lateness,
 * time-efficiency, pro-ration — is the REAL production function.
 *
 * Cleans up after itself, pass or fail.
 *
 * Run:  node --env-file=.env prisma/audit-night-shift.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  isLateForShift,
  lateMinutesForShift,
} from "../lib/attendance/validation.ts";
import { timeEfficiency } from "../lib/time-efficiency.ts";
import { payableDays } from "../lib/payroll/proration.ts";
import { averagePunchInMinutes, minutesToClock } from "../lib/reports/attendance.ts";

const db = new PrismaClient();

const TAG = "ZZ-NIGHT";
// The company's REAL shifts.
const NIGHT = { name: `${TAG} Night 18:00-03:00`, startTime: "18:00", endTime: "03:00" };
const DAY = { name: `${TAG} Day 09:00-17:00`, startTime: "09:00", endTime: "17:00" };

function h(label: string) {
  console.log(`\n${"═".repeat(66)}\n${label}\n${"═".repeat(66)}`);
}
function finding(area: string, verdict: "BROKEN" | "CORRECT", detail: string) {
  console.log(`\n[${verdict}]  ${area}\n         ${detail}`);
}

async function cleanup() {
  const emps = await db.employee.findMany({
    where: { employeeCode: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = emps.map((e) => e.id);
  await db.attendance.deleteMany({ where: { employeeId: { in: ids } } });
  await db.employee.deleteMany({ where: { id: { in: ids } } });
  await db.shift.deleteMany({ where: { name: { startsWith: TAG } } });
}

// ── The punch route's CURRENT logic, copied verbatim ──────────────────────
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

/** Exactly what app/api/attendance/punch/route.ts does today. */
async function legacyPunch(
  employeeId: string,
  now: Date,
  shift: { startTime: string; gracePeriodMinutes: number },
): Promise<string> {
  const existing = await db.attendance.findFirst({
    where: { employeeId, date: { gte: startOfDay(now), lt: endOfDay(now) } },
    orderBy: { date: "desc" },
  });

  if (!existing) {
    const lateMinutes = lateMinutesForShift(now, shift.startTime, shift.gracePeriodMinutes);
    await db.attendance.create({
      data: {
        employeeId,
        date: startOfDay(now),
        checkIn: now,
        channel: "WEB",
        lateFlag: lateMinutes !== null,
        lateMinutes,
        checkInNote: "audit",
      },
    });
    return "CHECK_IN (new row created)";
  }
  if (existing.checkIn && !existing.checkOut) {
    await db.attendance.update({ where: { id: existing.id }, data: { checkOut: now } });
    return "CHECK_OUT (existing row closed)";
  }
  return "ALREADY_COMPLETE (no write)";
}

function fmt(d: Date | null): string {
  if (!d) return "null";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function main() {
  await cleanup();

  const night = await db.shift.create({
    data: { ...NIGHT, gracePeriodMinutes: 0, createdBy: "audit" },
  });
  const day = await db.shift.create({
    data: { ...DAY, gracePeriodMinutes: 0, createdBy: "audit" },
  });

  const nightEmp = await db.employee.create({
    data: {
      employeeCode: `${TAG}-N1`,
      name: `${TAG} Night Worker`,
      department: "Assembly",
      joiningDate: new Date(2026, 0, 1),
      shiftId: night.id,
    },
  });
  const dayEmp = await db.employee.create({
    data: {
      employeeCode: `${TAG}-D1`,
      name: `${TAG} Day Worker`,
      department: "Assembly",
      joiningDate: new Date(2026, 0, 1),
      shiftId: day.id,
    },
  });

  // The real scenario: 8 July 2026 18:10 → 9 July 2026 03:05.
  const checkInAt = new Date(2026, 6, 8, 18, 10);
  const checkOutAt = new Date(2026, 6, 9, 3, 5);

  h("AREA 1 — Attendance row coherence (night shift 18:00–03:00)");
  console.log(`punch 1 @ ${fmt(checkInAt)}  →  ${await legacyPunch(nightEmp.id, checkInAt, night)}`);
  console.log(`punch 2 @ ${fmt(checkOutAt)}  →  ${await legacyPunch(nightEmp.id, checkOutAt, night)}`);

  const rows = await db.attendance.findMany({
    where: { employeeId: nightEmp.id },
    orderBy: { date: "asc" },
  });
  console.log(`\nAttendance rows produced: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `  date=${fmt(r.date).slice(0, 10)}  checkIn=${fmt(r.checkIn)}  checkOut=${fmt(r.checkOut)}  lateFlag=${r.lateFlag} lateMinutes=${r.lateMinutes}`,
    );
  }
  const coherent =
    rows.length === 1 && rows[0].checkIn !== null && rows[0].checkOut !== null;
  finding(
    "Attendance row coherence",
    coherent ? "CORRECT" : "BROKEN",
    coherent
      ? "one row spanning both punches"
      : `expected 1 row with both checkIn and checkOut; got ${rows.length} row(s). ` +
        `The 03:05 punch fell on the NEXT calendar day, so the date-keyed lookup ` +
        `(date >= startOfDay(now)) never found day 1's open row and treated the ` +
        `checkout as a brand-new check-in.`,
  );

  h("AREA 2 — Lateness for the 18:10 check-in vs 18:00 shift start");
  const lateMin = lateMinutesForShift(checkInAt, night.startTime, night.gracePeriodMinutes);
  const isLate = isLateForShift(checkInAt, night.startTime, night.gracePeriodMinutes);
  console.log(`lateMinutesForShift(18:10, "18:00", grace 0) = ${lateMin}`);
  console.log(`isLateForShift(...)                          = ${isLate}`);
  finding(
    "Lateness (isLateForShift)",
    lateMin === 10 && isLate ? "CORRECT" : "BROKEN",
    lateMin === 10 && isLate
      ? "18:10 against an 18:00 start = 10 minutes late, correctly flagged"
      : `expected 10 minutes late; got ${lateMin}`,
  );
  // The after-midnight edge, reported for completeness.
  const afterMidnight = lateMinutesForShift(new Date(2026, 6, 9, 0, 30), "18:00", 0);
  console.log(
    `\n  (edge) a 00:30 arrival for the same 18:00 shift → ${afterMidnight} ` +
      `— treated as NOT late, because 00:30 is numerically before 18:00.`,
  );

  h("AREA 3 — Time efficiency across midnight (hours worked)");
  // Feed the function the INTENDED timestamps, isolating its own arithmetic.
  const eff = timeEfficiency(100, checkInAt, checkOutAt);
  const hours = (checkOutAt.getTime() - checkInAt.getTime()) / 3_600_000;
  console.log(`checkOut − checkIn      = ${hours.toFixed(4)} h  (expected 8.9167 = 8h55m)`);
  console.log(`timeEfficiency(100 u)   = ${eff === null ? "null" : eff.toFixed(4)} units/hour`);
  const arithmeticOk = Math.abs(hours - 8.9166667) < 0.001 && eff !== null && eff > 0;
  finding(
    "Time efficiency — arithmetic",
    arithmeticOk ? "CORRECT" : "BROKEN",
    arithmeticOk
      ? "subtracts full timestamps, not times-of-day, so midnight is a non-event: 8h55m positive"
      : `expected 8.9167h positive; got ${hours}`,
  );
  // But what does it get from the DATA the route actually wrote?
  const realRow = rows[0];
  const effReal = timeEfficiency(100, realRow?.checkIn, realRow?.checkOut);
  console.log(
    `\ntimeEfficiency on the row the route ACTUALLY wrote = ${effReal === null ? "null" : effReal.toFixed(4)}`,
  );
  finding(
    "Time efficiency — in practice",
    effReal === null ? "BROKEN" : "CORRECT",
    effReal === null
      ? "returns null: the stored row has checkOut = null because of Area 1, so a night shift can never show an efficiency figure"
      : "produces a real figure from stored data",
  );

  h("AREA 4 — Payroll pro-ration attributes the shift to one working day");
  const pd = payableDays("2026-07", new Date(2026, 0, 1), null);
  console.log(`payableDays("2026-07", joined 2026-01-01, not offboarded) = ${JSON.stringify(pd)}`);
  console.log(
    "payableDays derives days from joiningDate/offboardedAt ONLY — it never reads Attendance.",
  );
  finding(
    "Payroll pro-ration",
    pd.daysWorked === 31 && pd.daysInMonth === 31 ? "CORRECT" : "BROKEN",
    pd.daysWorked === 31
      ? "calendar-based, so an overnight shift can neither double-count nor lose a day; unaffected by the Area 1 bug"
      : `unexpected: ${JSON.stringify(pd)}`,
  );

  h("AREA 5 — Reports average punch-in for night-shift punches");
  const p2300 = new Date(2026, 6, 8, 23, 0);
  const p0100 = new Date(2026, 6, 9, 1, 0);
  const linear = averagePunchInMinutes([p2300, p0100]);
  console.log(`linear mean of 23:00 (1380) and 01:00 (60) = ${linear} min → ${minutesToClock(linear!)}`);
  finding(
    "Average punch-in (night shift)",
    linear === 720 ? "BROKEN" : "CORRECT",
    linear === 720
      ? "linear mean gives 12:00 — the exact opposite of the true ~00:00 average, because the two punches sit either side of midnight"
      : `got ${linear}`,
  );

  h("CONTROL — the 09:00–17:00 day shift under the SAME current logic");
  const dIn = new Date(2026, 6, 8, 9, 5);
  const dOut = new Date(2026, 6, 8, 17, 2);
  console.log(`punch 1 @ ${fmt(dIn)}  →  ${await legacyPunch(dayEmp.id, dIn, day)}`);
  console.log(`punch 2 @ ${fmt(dOut)}  →  ${await legacyPunch(dayEmp.id, dOut, day)}`);
  const dRows = await db.attendance.findMany({ where: { employeeId: dayEmp.id } });
  console.log(`\nDay-shift rows: ${dRows.length}`);
  for (const r of dRows) {
    console.log(
      `  date=${fmt(r.date).slice(0, 10)}  checkIn=${fmt(r.checkIn)}  checkOut=${fmt(r.checkOut)}  lateMinutes=${r.lateMinutes}`,
    );
  }
  const dayEff = timeEfficiency(100, dRows[0]?.checkIn, dRows[0]?.checkOut);
  console.log(`day-shift efficiency = ${dayEff === null ? "null" : dayEff.toFixed(4)} units/hour`);
  const dayLinear = averagePunchInMinutes([new Date(2026, 6, 8, 9, 0), new Date(2026, 6, 9, 9, 30)]);
  console.log(`day-shift avg punch-in of 09:00 & 09:30 = ${minutesToClock(dayLinear!)}`);
  finding(
    "Day shift (control)",
    dRows.length === 1 && dRows[0].checkOut !== null && dayEff !== null
      ? "CORRECT"
      : "BROKEN",
    "this is the behaviour the fix must preserve exactly",
  );
}

main()
  .catch((err) => {
    console.error("AUDIT CRASHED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await db.$disconnect();
    console.log("\ncleanup complete");
  });
