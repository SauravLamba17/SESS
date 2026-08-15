/**
 * NIGHT-SHIFT FIX VERIFICATION — the same 18:00–03:00 scenario the audit ran,
 * now driven through the FIXED production logic (resolvePunch / shiftDateFor /
 * lateMinutesForShift / circularMeanMinutes), plus the 09:00–17:00 day shift as
 * a regression control on every single behaviour.
 *
 * Cleans up after itself, pass or fail.
 *
 * Run:  node --env-file=.env prisma/verify-night-shift.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  isLateForShift,
  lateMinutesForShift,
  resolvePunch,
  shiftCrossesMidnight,
  shiftDateFor,
  MAX_OPEN_SHIFT_HOURS,
} from "../lib/attendance/validation.ts";
import { timeEfficiency } from "../lib/time-efficiency.ts";
import { payableDays } from "../lib/payroll/proration.ts";
import {
  averagePunchInMinutes,
  circularMeanMinutes,
  linearMeanMinutes,
  minutesToClock,
  computeAttendance,
  type AttendanceRow,
} from "../lib/reports/attendance.ts";
import type { ReportEmployee } from "../lib/reports/types.ts";
import { parseRange, ymd } from "../lib/reports/range.ts";

const db = new PrismaClient();

const TAG = "ZZ-NIGHTFIX";
const NIGHT = { startTime: "18:00", endTime: "03:00" }; // the REAL night shift
const DAY = { startTime: "09:00", endTime: "17:00" }; // the REAL day shift

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
}
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, a === e ? "" : `expected ${e}, got ${a}`);
}
function step(n: string, title: string) {
  console.log(`\n── ${n}: ${title} ${"─".repeat(Math.max(0, 44 - title.length))}`);
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

/** The FIXED punch route's logic, using the real exported helpers. */
async function punch(
  employeeId: string,
  now: Date,
  shift: { startTime: string; endTime: string; gracePeriodMinutes: number },
): Promise<string> {
  const openSince = new Date(now.getTime() - MAX_OPEN_SHIFT_HOURS * 3_600_000);
  const recentRow = await db.attendance.findFirst({
    where: { employeeId, checkIn: { not: null, gte: openSince } },
    orderBy: { checkIn: "desc" },
  });
  const decision = resolvePunch({ at: now, shift, recentRow });

  if (decision.action === "CHECK_IN") {
    const lateMinutes = lateMinutesForShift(
      now,
      shift.startTime,
      shift.gracePeriodMinutes,
      shift.endTime,
    );
    await db.attendance.create({
      data: {
        employeeId,
        date: decision.shiftDate,
        checkIn: now,
        channel: "WEB",
        lateFlag: lateMinutes !== null,
        lateMinutes,
        checkInNote: "verify",
      },
    });
    return `CHECK_IN (row dated ${ymd(decision.shiftDate)})`;
  }
  if (decision.action === "CHECK_OUT") {
    await db.attendance.update({ where: { id: decision.rowId }, data: { checkOut: now } });
    return "CHECK_OUT (open row closed)";
  }
  return "ALREADY_COMPLETE (no write)";
}

async function main() {
  await cleanup();

  const night = await db.shift.create({
    data: { name: `${TAG} Night`, ...NIGHT, gracePeriodMinutes: 0, createdBy: "verify" },
  });
  const day = await db.shift.create({
    data: { name: `${TAG} Day`, ...DAY, gracePeriodMinutes: 0, createdBy: "verify" },
  });
  const nightEmp = await db.employee.create({
    data: {
      employeeCode: `${TAG}-N1`, name: `${TAG} Night Worker`, department: "Assembly",
      joiningDate: new Date(2026, 0, 1), shiftId: night.id,
    },
  });
  const dayEmp = await db.employee.create({
    data: {
      employeeCode: `${TAG}-D1`, name: `${TAG} Day Worker`, department: "Assembly",
      joiningDate: new Date(2026, 0, 1), shiftId: day.id,
    },
  });

  // ── 0: the shift-window rule itself ─────────────────────────────
  step("0", "shift-window classification");
  check("18:00-03:00 is recognised as crossing midnight", shiftCrossesMidnight(NIGHT));
  check("09:00-17:00 is NOT", !shiftCrossesMidnight(DAY));
  check("a null shift is not treated as overnight", !shiftCrossesMidnight(null));
  check("a malformed shift is not treated as overnight", !shiftCrossesMidnight({ startTime: "x", endTime: "y" }));

  step("0b", "shiftDateFor — which calendar day a punch belongs to");
  eq("night 18:10 on the 8th → the 8th", ymd(shiftDateFor(new Date(2026, 6, 8, 18, 10), NIGHT)), "2026-07-08");
  eq("night 00:30 on the 9th → still the 8th", ymd(shiftDateFor(new Date(2026, 6, 9, 0, 30), NIGHT)), "2026-07-08");
  eq("night 02:59 on the 9th → still the 8th (last minute of the tail)", ymd(shiftDateFor(new Date(2026, 6, 9, 2, 59), NIGHT)), "2026-07-08");
  // CONTRACT: the tail is the shift's own after-midnight window, 00:00 up to
  // endTime. A punch at 03:05 is five minutes PAST the 03:00 end, so it is its
  // own day. This never affects a real check-OUT — those close the already-open
  // row (correctly dated the 8th, asserted in section 1) and never consult
  // shiftDateFor at all. It only decides the date of a NEW row.
  eq("night 03:05 (past the shift end) → its own day", ymd(shiftDateFor(new Date(2026, 6, 9, 3, 5), NIGHT)), "2026-07-09");
  eq("DAY 09:05 on the 8th → the 8th (unchanged)", ymd(shiftDateFor(new Date(2026, 6, 8, 9, 5), DAY)), "2026-07-08");
  eq("DAY 17:02 on the 8th → the 8th (unchanged)", ymd(shiftDateFor(new Date(2026, 6, 8, 17, 2), DAY)), "2026-07-08");
  eq("no shift → the punch's own day (unchanged)", ymd(shiftDateFor(new Date(2026, 6, 8, 23, 59), null)), "2026-07-08");

  // ── 1: THE SCENARIO — 18:10 day 1 → 03:05 day 2 ─────────────────
  step("1", "AREA 1 — night shift produces ONE coherent row");
  const inAt = new Date(2026, 6, 8, 18, 10);
  const outAt = new Date(2026, 6, 9, 3, 5);
  console.log(`  punch 1 @ 2026-07-08 18:10 → ${await punch(nightEmp.id, inAt, night)}`);
  console.log(`  punch 2 @ 2026-07-09 03:05 → ${await punch(nightEmp.id, outAt, night)}`);

  const rows = await db.attendance.findMany({ where: { employeeId: nightEmp.id } });
  eq("exactly ONE attendance row (was 2 before the fix)", rows.length, 1);
  const row = rows[0];
  eq("row is dated the shift's START day", ymd(row.date), "2026-07-08");
  check("checkIn is 18:10", row.checkIn?.getHours() === 18 && row.checkIn?.getMinutes() === 10);
  check("checkOut is 03:05 the NEXT day", row.checkOut?.getHours() === 3 && row.checkOut?.getMinutes() === 5);
  check("checkOut is on the following calendar date", row.checkOut !== null && ymd(row.checkOut) === "2026-07-09");

  step("1b", "a third punch is not turned into a bogus check-in");
  const stray = await punch(nightEmp.id, new Date(2026, 6, 9, 3, 30), night);
  console.log(`  punch 3 @ 2026-07-09 03:30 → ${stray}`);
  eq("still exactly one row", (await db.attendance.count({ where: { employeeId: nightEmp.id } })), 1);

  // ── 2: lateness ─────────────────────────────────────────────────
  step("2", "AREA 2 — lateness against the 18:00 start");
  eq("18:10 → 10 minutes late", lateMinutesForShift(inAt, NIGHT.startTime, 0, NIGHT.endTime), 10);
  check("isLateForShift agrees", isLateForShift(inAt, NIGHT.startTime, 0, NIGHT.endTime));
  eq("stored lateMinutes on the row", row.lateMinutes, 10);
  eq("stored lateFlag", row.lateFlag, true);
  eq("17:55 (early) → not late", lateMinutesForShift(new Date(2026, 6, 8, 17, 55), NIGHT.startTime, 0, NIGHT.endTime), null);
  // The after-midnight gap the audit surfaced.
  eq(
    "00:30 arrival → 390 min late (was wrongly 'on time')",
    lateMinutesForShift(new Date(2026, 6, 9, 0, 30), NIGHT.startTime, 0, NIGHT.endTime),
    390,
  );
  eq(
    "without endTime the old behaviour is preserved exactly",
    lateMinutesForShift(new Date(2026, 6, 9, 0, 30), NIGHT.startTime, 0),
    null,
  );

  // ── 3: time efficiency ──────────────────────────────────────────
  step("3", "AREA 3 — hours worked across midnight");
  const hours = (row.checkOut!.getTime() - row.checkIn!.getTime()) / 3_600_000;
  eq("duration is 8h55m", Math.round(hours * 60), 535);
  const eff = timeEfficiency(100, row.checkIn, row.checkOut);
  check("efficiency from the STORED row is a real positive number", eff !== null && eff > 0,
    `${eff === null ? "null" : eff.toFixed(4)} units/hour`);
  eq("100 units / 8.9167h ≈ 11.21", eff === null ? null : Math.round(eff * 100) / 100, 11.21);

  // ── 4: payroll pro-ration ───────────────────────────────────────
  step("4", "AREA 4 — payroll pro-ration attributes one day");
  const pd = payableDays("2026-07", new Date(2026, 0, 1), null);
  eq("full July for a long-tenured employee", pd, { daysWorked: 31, daysInMonth: 31 });
  const joinedMid = payableDays("2026-07", new Date(2026, 6, 8), null);
  eq("joined 8 July → 24 days (8th–31st inclusive)", joinedMid.daysWorked, 24);
  console.log("        payableDays reads joiningDate/offboardedAt only — never Attendance,");
  console.log("        so one overnight shift can neither add nor lose a payable day.");

  // ── 5: THE CIRCULAR MEAN ────────────────────────────────────────
  step("5", "AREA 5 — circular mean, hand-verified");
  const p23 = new Date(2026, 6, 8, 23, 0);
  const p01 = new Date(2026, 6, 9, 1, 0);
  const lin = linearMeanMinutes([p23, p01]);
  const circ = circularMeanMinutes([p23, p01]);
  console.log(`  linear mean of 23:00 & 01:00   = ${lin} min → ${minutesToClock(lin!)}   (wrong)`);
  console.log(`  circular mean of 23:00 & 01:00 = ${circ} min → ${minutesToClock(circ!)}   (correct)`);
  eq("linear mean is the nonsensical 12:00", minutesToClock(lin!), "12:00");
  eq("CIRCULAR MEAN OF 23:00 AND 01:00 IS 00:00", circ, 0);
  eq("…and formats as 00:00", minutesToClock(circ!), "00:00");

  // More night-shift cases.
  eq(
    "22:00 & 02:00 → 00:00",
    minutesToClock(circularMeanMinutes([new Date(2026, 6, 8, 22, 0), new Date(2026, 6, 9, 2, 0)])!),
    "00:00",
  );
  eq(
    "18:00 & 20:00 (both pre-midnight) → 19:00",
    minutesToClock(circularMeanMinutes([new Date(2026, 6, 8, 18, 0), new Date(2026, 6, 8, 20, 0)])!),
    "19:00",
  );
  eq(
    "a single 23:30 punch returns itself",
    minutesToClock(circularMeanMinutes([new Date(2026, 6, 8, 23, 30)])!),
    "23:30",
  );
  check(
    "antipodal times (06:00 & 18:00) have no mean direction → null, not a fabricated number",
    circularMeanMinutes([new Date(2026, 6, 8, 6, 0), new Date(2026, 6, 8, 18, 0)]) === null,
  );
  eq("no punches → null", circularMeanMinutes([]), null);

  step("5b", "the day shift keeps the linear mean, unchanged");
  const d9 = new Date(2026, 6, 8, 9, 0);
  const d930 = new Date(2026, 6, 9, 9, 30);
  eq("09:00 & 09:30 linear → 09:15", minutesToClock(linearMeanMinutes([d9, d930])!), "09:15");
  eq("averagePunchInMinutes defaults to linear", averagePunchInMinutes([d9, d930]), 555);
  eq("explicit linear matches the default", averagePunchInMinutes([d9, d930], false), 555);
  // For clustered day-shift times the circular mean agrees anyway — evidence
  // that the day case was never the problem.
  eq("circular would give the same 09:15 for clustered day times",
    minutesToClock(circularMeanMinutes([d9, d930])!), "09:15");

  // ── 6: end-to-end through computeAttendance ─────────────────────
  step("6", "AREA 5 end-to-end — computeAttendance picks the right mean");
  const parsed = parseRange("2026-07-01", "2026-07-31");
  if (!parsed.ok) throw new Error("range");
  const range = parsed.range;

  const nightEmployee: ReportEmployee = {
    id: nightEmp.id, name: nightEmp.name, employeeCode: nightEmp.employeeCode,
    department: "Assembly", active: true, joiningDate: nightEmp.joiningDate,
    offboardedAt: null, shiftCrossesMidnight: true,
  };
  const dayEmployee: ReportEmployee = {
    id: dayEmp.id, name: dayEmp.name, employeeCode: dayEmp.employeeCode,
    department: "Packing", active: true, joiningDate: dayEmp.joiningDate,
    offboardedAt: null, shiftCrossesMidnight: false,
  };

  const reportRows: AttendanceRow[] = [
    { employeeId: nightEmp.id, checkIn: p23, lateFlag: true, lateMinutes: 300 },
    { employeeId: nightEmp.id, checkIn: p01, lateFlag: true, lateMinutes: 420 },
    { employeeId: dayEmp.id, checkIn: d9, lateFlag: false, lateMinutes: null },
    { employeeId: dayEmp.id, checkIn: d930, lateFlag: false, lateMinutes: null },
  ];
  const result = computeAttendance(reportRows, [nightEmployee, dayEmployee], range);

  const nRow = result.byEmployee.find((e) => e.employeeId === nightEmp.id)!;
  const dRow = result.byEmployee.find((e) => e.employeeId === dayEmp.id)!;
  eq("night employee averaged circularly → 00:00", nRow.avgPunchIn, "00:00");
  eq("night employee method flagged", nRow.avgPunchInMethod, "circular");
  eq("DAY employee still 09:15", dRow.avgPunchIn, "09:15");
  eq("day employee method flagged linear", dRow.avgPunchInMethod, "linear");

  const assembly = result.byDepartment.find((d) => d.department === "Assembly")!;
  const packing = result.byDepartment.find((d) => d.department === "Packing")!;
  eq("night department uses circular", assembly.avgPunchInMethod, "circular");
  eq("night department average → 00:00", assembly.avgPunchIn, "00:00");
  eq("day-only department stays linear", packing.avgPunchInMethod, "linear");
  eq("day-only department average → 09:15", packing.avgPunchIn, "09:15");
  check("scope containing a night shift is flagged", result.hasOvernightShift);

  const dayOnly = computeAttendance(
    [reportRows[2], reportRows[3]],
    [dayEmployee],
    range,
  );
  eq("a day-only scope reports linear org method", dayOnly.orgAvgPunchInMethod, "linear");
  eq("a day-only scope org average → 09:15", dayOnly.orgAvgPunchIn, "09:15");
  check("day-only scope not flagged overnight", !dayOnly.hasOvernightShift);

  // ── 7: DAY-SHIFT REGRESSION CONTROL ─────────────────────────────
  step("7", "REGRESSION — the 09:00–17:00 day shift is untouched");
  console.log(`  punch 1 @ 2026-07-08 09:05 → ${await punch(dayEmp.id, new Date(2026, 6, 8, 9, 5), day)}`);
  console.log(`  punch 2 @ 2026-07-08 17:02 → ${await punch(dayEmp.id, new Date(2026, 6, 8, 17, 2), day)}`);
  const dRows = await db.attendance.findMany({ where: { employeeId: dayEmp.id } });
  eq("one row, as before", dRows.length, 1);
  eq("dated the punch's own day, as before", ymd(dRows[0].date), "2026-07-08");
  eq("late by 5 minutes, as before", dRows[0].lateMinutes, 5);
  check("closed same day", dRows[0].checkOut !== null);
  const dEff = timeEfficiency(100, dRows[0].checkIn, dRows[0].checkOut);
  check("efficiency unchanged", dEff !== null && Math.abs(dEff - 12.5786) < 0.001,
    `${dEff === null ? "null" : dEff.toFixed(4)} units/hour`);
  const dStray = await punch(dayEmp.id, new Date(2026, 6, 8, 17, 30), day);
  eq("a third same-day punch is still ALREADY_COMPLETE", dStray, "ALREADY_COMPLETE (no write)");
  eq("still one row", (await db.attendance.count({ where: { employeeId: dayEmp.id } })), 1);

  step("7b", "next day's check-in is NOT swallowed by a stale open row");
  const staleEmp = await db.employee.create({
    data: {
      employeeCode: `${TAG}-S1`, name: `${TAG} Forgot Checkout`, department: "Assembly",
      joiningDate: new Date(2026, 0, 1), shiftId: day.id,
    },
  });
  console.log(`  day 1 09:00 in  → ${await punch(staleEmp.id, new Date(2026, 6, 8, 9, 0), day)}`);
  console.log(`  (no checkout — forgotten)`);
  console.log(`  day 2 09:00 in  → ${await punch(staleEmp.id, new Date(2026, 6, 9, 9, 0), day)}`);
  const sRows = await db.attendance.findMany({
    where: { employeeId: staleEmp.id }, orderBy: { date: "asc" },
  });
  eq("two separate days, not one merged row", sRows.length, 2);
  check("the stale day-1 row stays open for HR to see", sRows[0].checkOut === null);
  check("day 2 opened its own row", sRows[1].checkOut === null && ymd(sRows[1].date) === "2026-07-09");

  console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("VERIFY CRASHED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await db.$disconnect();
    console.log("cleanup complete");
  });
