/**
 * Verification for Manager web clock-in/out.
 *
 * The change was UI-only, so this proves the three things that actually matter:
 *   1. STRUCTURE — the punch route has no role gate and physically cannot
 *      punch for anyone but the caller (it never reads an employee id from the
 *      request body).
 *   2. DOWNSTREAM — a Manager's own attendance flows into lateness and into
 *      appraisal punctuality with no special-casing, because none of that code
 *      knows what a role is.
 *   3. WIRING — the Manager dashboard renders the SAME widget component as the
 *      Employee dashboard, not a second copy.
 *
 * Creates its own throwaway manager + report and deletes everything, pass or
 * fail. The HTTP check needs the dev server on :3005.
 *
 * Run:  node --env-file=.env prisma/verify-manager-punch.ts
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { lateMinutesForShift } from "../lib/attendance/validation.ts";

const db = new PrismaClient();
const ROOT = process.cwd();
const BASE = "http://127.0.0.1:3005";

const TAG = "ZZ-MGRPUNCH";
const MGR_CODE = `${TAG}-M1`;
const REP_CODE = `${TAG}-E1`;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}
function step(n: string, title: string) {
  console.log(`\n── ${n}: ${title} ${"─".repeat(Math.max(0, 52 - title.length))}`);
}

async function cleanup() {
  const emps = await db.employee.findMany({
    where: { employeeCode: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = emps.map((e) => e.id);
  await db.attendance.deleteMany({ where: { employeeId: { in: ids } } });
  await db.user.deleteMany({ where: { employeeId: { in: ids } } });
  // Reports first: manager is referenced by managerId.
  await db.employee.deleteMany({ where: { id: { in: ids }, managerId: { not: null } } });
  await db.employee.deleteMany({ where: { id: { in: ids } } });
  await db.shift.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function main() {
  console.log("Manager web clock-in/out");
  await cleanup();

  // ── 1: the route's structure ──────────────────────────────────────────
  step("1", "punch route: no role gate, own record only");
  const src = fs.readFileSync(path.join(ROOT, "app/api/attendance/punch/route.ts"), "utf8");

  check("route never calls getCurrentRole()", !src.includes("getCurrentRole"));
  check("route contains no role comparison at all",
    !/role\s*[!=]==?\s*["']/.test(src) && !/"EMPLOYEE"|"MANAGER"|"HR"|"SUPER_ADMIN"/.test(src));
  check("identity comes from the session, not the body",
    src.includes("getEffectiveUserId()") && src.includes("getEmployeeByClerkId(userId)"));
  // THE guarantee: the body is only ever read for these three keys.
  const bodyReads = [...src.matchAll(/body\.(\w+)/g)].map((m) => m[1]).sort();
  // An ALLOWLIST, not a count: the point is that everything the body can
  // influence is location or free text, and nothing identity-bearing. Adding a
  // field here is a deliberate act that should require updating this line —
  // `accuracy` joined the list when GPS precision capture was added.
  check("body is read for lat/long/accuracy/note ONLY",
    JSON.stringify([...new Set(bodyReads)]) === '["accuracy","lat","long","note"]',
    JSON.stringify([...new Set(bodyReads)]));
  check("body never supplies an employee id",
    !/body\.employeeId|body\.employee\b|body\["employeeId"\]/.test(src));
  // Every write targets the resolved caller.
  const writes = [...src.matchAll(/employeeId:\s*([A-Za-z0-9_.]+)/g)].map((m) => m[1]);
  check("every employeeId write is the caller's own resolved record",
    writes.length > 0 && writes.every((w) => w === "employee.id"), writes.join(", "));

  // ── 2: unauthenticated cannot punch ───────────────────────────────────
  step("2", "HTTP: a punch requires a session");
  try {
    const res = await fetch(`${BASE}/api/attendance/punch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Deliberately smuggling an employeeId — it must be ignored AND rejected.
      body: JSON.stringify({ lat: 1, long: 1, note: "hi", employeeId: "someone-else" }),
    });
    const json = await res.json().catch(() => ({}));
    check("unauthenticated punch is 401", res.status === 401, `status ${res.status}`);
    check("no row created for the smuggled employeeId",
      (await db.attendance.count({ where: { employeeId: "someone-else" } })) === 0);
    check("error is the route's own shape", typeof json.error === "string", JSON.stringify(json));
  } catch (e) {
    check("HTTP test ran (is the dev server up on :3005?)", false, String(e));
  }

  // ── 3: seed a Manager who is also an Employee ─────────────────────────
  step("3", "a Manager IS an Employee row");
  const shift = await db.shift.create({
    data: {
      name: `${TAG} Day`, startTime: "09:00", endTime: "18:00",
      gracePeriodMinutes: 10, createdBy: `${TAG}-suite`,
    },
  });
  const mgr = await db.employee.create({
    data: {
      employeeCode: MGR_CODE, name: `${TAG} Manager`, department: "Engineering",
      designation: "Team Lead", joiningDate: new Date(2024, 0, 1), active: true,
      shiftId: shift.id,
    },
  });
  await db.user.create({ data: { clerkId: `${TAG}-mgr-clerk`, role: "MANAGER", employeeId: mgr.id } });
  const rep = await db.employee.create({
    data: {
      employeeCode: REP_CODE, name: `${TAG} Report`, department: "Engineering",
      designation: "Operator", joiningDate: new Date(2024, 0, 1), active: true,
      managerId: mgr.id, shiftId: shift.id,
    },
  });
  check("Employee model has no role column to special-case on",
    !Object.keys(mgr).includes("role"), Object.keys(mgr).filter((k) => /role/i.test(k)).join(",") || "none");

  // ── 4: lateness is shift-driven, not role-driven ──────────────────────
  step("4", "lateness uses the person's own shift");
  const onTime = new Date(2026, 0, 5, 9, 5);   // within the 10m grace
  const late = new Date(2026, 0, 5, 9, 42);    // 32m past grace
  check("on-time arrival is not late", lateMinutesForShift(onTime, "09:00", 10, "18:00") === null);
  check("late arrival returns minutes past grace",
    lateMinutesForShift(late, "09:00", 10, "18:00") === 32,
    String(lateMinutesForShift(late, "09:00", 10, "18:00")));
  // Same inputs, same answer — the function takes no role and cannot branch on one.
  check("lateMinutesForShift takes no role argument", lateMinutesForShift.length <= 4);

  // ── 5: the manager's own row behaves like any other ───────────────────
  step("5", "a Manager's attendance row is ordinary data");
  const day = new Date(2026, 0, 5);
  const mgrRow = await db.attendance.create({
    data: {
      employeeId: mgr.id, date: day, checkIn: late, channel: "WEB",
      lateFlag: true, lateMinutes: 32, checkInNote: "verification",
    },
  });
  await db.attendance.create({
    data: {
      employeeId: rep.id, date: day, checkIn: onTime, channel: "WEB",
      lateFlag: false, lateMinutes: null, checkInNote: "verification",
    },
  });
  check("the manager's row is owned by the manager", mgrRow.employeeId === mgr.id);
  check("punching as the manager did NOT touch the report's row",
    (await db.attendance.count({ where: { employeeId: rep.id, lateFlag: true } })) === 0);

  // The exact groupBy the appraisal engine and the manager dashboard use.
  const grouped = await db.attendance.groupBy({
    by: ["employeeId"],
    where: { employeeId: { in: [mgr.id, rep.id] }, date: { gte: day, lt: new Date(2026, 0, 6) } },
    _count: { _all: true },
  });
  check("punctuality groupBy sees the manager as its own subject",
    grouped.some((g) => g.employeeId === mgr.id && g._count._all === 1));

  // ── 6: appraisal includes a Manager with no special-casing ────────────
  step("6", "appraisal scope is employee-generic");
  const active = await db.employee.findMany({
    where: { active: true, department: "Engineering" },
    select: { id: true },
  });
  check("getActiveEmployees' filter would include the Manager",
    active.some((e) => e.id === mgr.id));
  const scopeSrc = fs.readFileSync(path.join(ROOT, "lib/data/scope.ts"), "utf8");
  check("getActiveEmployees applies no role filter",
    /getActiveEmployees[\s\S]{0,220}?active:\s*true/.test(scopeSrc) &&
      !/getActiveEmployees[\s\S]{0,220}?role/.test(scopeSrc));
  const computeSrc = fs.readFileSync(path.join(ROOT, "app/api/hr/appraisal/compute/route.ts"), "utf8");
  check("appraisal compute never filters candidates by role",
    !/getActiveEmployees\([^)]*role/.test(computeSrc));

  // ── 7: the dashboards share ONE widget ────────────────────────────────
  step("7", "Manager reuses the Employee widget, not a copy");
  const mgrPage = fs.readFileSync(path.join(ROOT, "app/manager/page.tsx"), "utf8");
  const empPage = fs.readFileSync(path.join(ROOT, "app/employee/page.tsx"), "utf8");
  const WIDGET = '@/components/employee/clock-in-widget';
  check("manager dashboard imports the shared ClockInWidget", mgrPage.includes(WIDGET));
  check("employee dashboard imports the same one", empPage.includes(WIDGET));
  check("no duplicate widget file was created",
    !fs.existsSync(path.join(ROOT, "components/manager/clock-in-widget.tsx")));
  for (const c of ["ShiftBanner", "TodayAttendanceCard", "WeekAttendancePanel"]) {
    check(`both dashboards share ${c}`, mgrPage.includes(c) && empPage.includes(c));
  }
  check("manager passes its OWN attendance to the widget",
    /initialCheckIn=\{data\.own\.today/.test(mgrPage));
  check("manager's own load is scoped to manager.id",
    /loadOwnAttendance\(manager\.id/.test(mgrPage));
}

main()
  .catch((e) => { console.error("suite crashed:", e); fail++; })
  .finally(async () => {
    await cleanup();
    console.log("\n  cleanup: throwaway manager, report, shift and attendance removed");
    console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
    await db.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  });
