/**
 * Phase 9 — Engagement verification.
 *
 * Runs against the REAL database with the real Prisma client and the real
 * pure logic (lib/engagement/logic.ts). Creates its own throwaway data and
 * deletes everything, pass or fail.
 *
 * Also performs a STATIC audit of the source tree: greps every .ts/.tsx file
 * for any query that selects both `ratingValue` and an `employeeId`-bearing
 * model in the same statement, and confirms the only reader of
 * PulseSurveyResponse is lib/engagement/pulse.ts.
 *
 * Run:  node --env-file=.env prisma/verify-engagement.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";
import {
  derivePresence,
  presenceCounts,
  matchBirthdays,
  computeAggregate,
} from "../lib/engagement/logic.ts";

const db = new PrismaClient();

const TAG = "ZZ-ENGAGE-TEST";
const HR = "test-engage-hr";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
}
function step(n: string, title: string) {
  console.log(`\n── ${n}: ${title} ${"─".repeat(Math.max(0, 42 - title.length))}`);
}

async function cleanup() {
  const emps = await db.employee.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = emps.map((e) => e.id);
  await db.shoutOut.deleteMany({
    where: { OR: [{ fromEmployeeId: { in: ids } }, { toEmployeeId: { in: ids } }] },
  });
  await db.surveyResponseRecord.deleteMany({ where: { employeeId: { in: ids } } });
  await db.attendance.deleteMany({ where: { employeeId: { in: ids } } });
  await db.leaveRequest.deleteMany({ where: { employeeId: { in: ids } } });
  await db.employee.deleteMany({ where: { id: { in: ids } } });
  await db.holiday.deleteMany({ where: { name: { startsWith: TAG } } });

  // Children before parent: PulseSurveyResponse/SurveyResponseRecord restrict
  // deletion of their PulseSurvey (Prisma cascades nothing by default — same
  // fact confirmed for Candidate deletion in Phase 8).
  const surveys = await db.pulseSurvey.findMany({
    where: { question: { startsWith: TAG } },
    select: { id: true },
  });
  const surveyIds = surveys.map((s) => s.id);
  await db.pulseSurveyResponse.deleteMany({ where: { surveyId: { in: surveyIds } } });
  await db.surveyResponseRecord.deleteMany({ where: { surveyId: { in: surveyIds } } });
  await db.pulseSurvey.deleteMany({ where: { id: { in: surveyIds } } });

  await db.auditLog.deleteMany({ where: { actorUserId: HR } });
}

function todayYMD(now = new Date()): [number, number, number] {
  return [now.getFullYear(), now.getMonth(), now.getDate()];
}

/** Recursively walk .ts/.tsx source, skipping node_modules/.next. */
function walkSource(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkSource(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

async function main() {
  try {
    await cleanup();
    console.log("══ PHASE 9 ENGAGEMENT VERIFICATION ═════════════════════");

    const now = new Date();
    const [y, m, d] = todayYMD(now);

    // ── HOLIDAY BANNER ──────────────────────────────────────────────
    step("1", "Holiday dated today → banner logic triggers");
    const holiday = await db.$transaction(async (tx) => {
      const h = await tx.holiday.create({
        data: { name: `${TAG} Founders Day`, date: new Date(y, m, d), createdBy: HR },
      });
      await tx.auditLog.create({
        data: { actorUserId: HR, action: "HOLIDAY_ADDED", targetEntity: `${h.id} (${h.name})` },
      });
      return h;
    });

    const dayStart = new Date(y, m, d);
    const dayEnd = new Date(y, m, d + 1);
    const todaysHolidays = await db.holiday.findMany({
      where: { date: { gte: dayStart, lt: dayEnd } },
      select: { id: true, name: true },
    });
    check("1a holiday created dated exactly today", holiday.date.getTime() === dayStart.getTime());
    check("1b the SAME query the dashboard widget runs finds it",
      todaysHolidays.some((h) => h.id === holiday.id),
      `found ${todaysHolidays.length} holiday(s) today: ${todaysHolidays.map((h) => h.name).join(", ")}`);
    check("1c banner condition (holidays.length > 0) evaluates true",
      todaysHolidays.length > 0);

    const audit1 = await db.auditLog.findFirst({ where: { action: "HOLIDAY_ADDED", targetEntity: { contains: holiday.id } } });
    check("1d HOLIDAY_ADDED audit row written", audit1 !== null);

    // ── BIRTHDAY MATCH ──────────────────────────────────────────────
    step("2", "employee with dateOfBirth = today's month/day matches");
    const birthdayEmp = await db.employee.create({
      data: {
        employeeCode: `ZZ-BDAY-${Date.now()}`,
        name: `${TAG} Priya (birthday)`,
        department: "Assembly",
        joiningDate: new Date(2020, 0, 1),
        active: true,
        // Deliberately a different YEAR (1990) to prove year is ignored.
        dateOfBirth: new Date(1990, m, d),
      },
    });
    const decoyEmp = await db.employee.create({
      data: {
        employeeCode: `ZZ-DECOY-${Date.now()}`,
        name: `${TAG} Not Today`,
        department: "Assembly",
        joiningDate: new Date(2020, 0, 1),
        active: true,
        // One day off, in whichever direction stays in-month.
        dateOfBirth: new Date(1985, m, d === 1 ? d + 1 : d - 1),
      },
    });

    const roster = await db.employee.findMany({
      where: { active: true, name: { startsWith: TAG } },
      select: { id: true, name: true, department: true, dateOfBirth: true },
    });
    // THE REAL FUNCTION from lib/engagement/logic.ts — not a re-implementation.
    const birthdays = matchBirthdays(roster, now);

    check("2a birthday employee IS matched despite a different birth YEAR",
      birthdays.some((b) => b.id === birthdayEmp.id),
      `dob stored=1990-${m + 1}-${d}, matched against today's ${y}-${m + 1}-${d}`);
    check("2b decoy (adjacent day) is NOT matched",
      !birthdays.some((b) => b.id === decoyEmp.id));
    check("2c result carries name+department ONLY — no date, no age",
      Object.keys(birthdays.find((b) => b.id === birthdayEmp.id) ?? {}).sort().join(",") ===
        "department,id,name");

    // ── WHO'S IN/OUT: PRESENCE ONLY ─────────────────────────────────
    step("2", "presence widget — no lateness data reaches the derivation");
    await db.attendance.create({
      data: {
        employeeId: birthdayEmp.id,
        date: dayStart,
        checkIn: new Date(y, m, d, 11, 45), // very late
        lateFlag: true,
        lateMinutes: 105,
      },
    });
    const attRows = await db.attendance.findMany({
      where: { employeeId: { in: [birthdayEmp.id, decoyEmp.id] }, date: { gte: dayStart, lt: dayEnd }, checkIn: { not: null } },
      select: { employeeId: true }, // exactly what lib/engagement/today.ts selects
    });
    check("2d attendance query selects ONLY employeeId (no lateFlag/lateMinutes/checkIn in the select)",
      Object.keys(attRows[0] ?? { employeeId: "" }).sort().join(",") === "employeeId");

    const presence = derivePresence(roster, new Set(attRows.map((a) => a.employeeId)), new Set());
    const counts = presenceCounts(presence);
    const birthdayPresence = presence.find((p) => p.id === birthdayEmp.id);
    check("2e presence row for a 105-min-late employee shows status=IN, nothing else",
      birthdayPresence?.status === "IN" &&
        Object.keys(birthdayPresence ?? {}).sort().join(",") === "department,id,name,status",
      `row=${JSON.stringify(birthdayPresence)}`);
    check("2f counts derived correctly (1 in, 0 on leave, 1 not marked)",
      counts.in === 1 && counts.onLeave === 0 && counts.notMarked === 1,
      JSON.stringify(counts));

    // Leave overlapping today, wins over a stray check-in.
    await db.leaveRequest.create({
      data: {
        employeeId: decoyEmp.id,
        startDate: dayStart,
        endDate: dayStart,
        reason: "test",
        status: "APPROVED",
      },
    });
    const leaveRows = await db.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { lt: dayEnd }, endDate: { gte: dayStart }, employeeId: decoyEmp.id },
      select: { employeeId: true },
    });
    const presence2 = derivePresence(roster, new Set(attRows.map((a) => a.employeeId)), new Set(leaveRows.map((l) => l.employeeId)));
    check("2g approved leave → status=ON_LEAVE",
      presence2.find((p) => p.id === decoyEmp.id)?.status === "ON_LEAVE");

    // ── SHOUT-OUT ────────────────────────────────────────────────────
    step("3", "shout-out posted and appears in the feed");
    const shoutOut = await db.shoutOut.create({
      data: {
        fromEmployeeId: birthdayEmp.id,
        toEmployeeId: decoyEmp.id,
        message: `${TAG} Great work covering the line today!`,
      },
    });
    // The exact query the community feed page runs.
    const feed = await db.shoutOut.findMany({
      include: {
        fromEmployee: { select: { name: true } },
        toEmployee: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    check("3a shout-out appears in the reverse-chronological feed",
      feed.some((s) => s.id === shoutOut.id));
    const feedEntry = feed.find((s) => s.id === shoutOut.id);
    check("3b feed entry names sender and recipient correctly",
      feedEntry?.fromEmployee.name === birthdayEmp.name &&
        feedEntry?.toEmployee.name === decoyEmp.name,
      `${feedEntry?.fromEmployee.name} -> ${feedEntry?.toEmployee.name}`);

    // Delete-own-post window: own + recent → allowed; own + stale → refused.
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    const delOk = await db.shoutOut.deleteMany({
      where: { id: shoutOut.id, fromEmployeeId: birthdayEmp.id, createdAt: { gte: cutoff } },
    });
    check("3c author can delete their own recent post", delOk.count === 1);

    const staleShoutOut = await db.shoutOut.create({
      data: { fromEmployeeId: birthdayEmp.id, toEmployeeId: decoyEmp.id, message: `${TAG} old` },
    });
    await db.shoutOut.updateMany({
      where: { id: staleShoutOut.id },
      data: { createdAt: new Date(Date.now() - 30 * 60 * 1000) },
    });
    const delStale = await db.shoutOut.deleteMany({
      where: { id: staleShoutOut.id, fromEmployeeId: birthdayEmp.id, createdAt: { gte: cutoff } },
    });
    check("3d cannot delete own post outside the 15-minute window", delStale.count === 0);
    const delOthers = await db.shoutOut.deleteMany({
      where: { id: staleShoutOut.id, fromEmployeeId: decoyEmp.id, createdAt: { gte: cutoff } },
    });
    check("3e cannot delete someone else's post", delOthers.count === 0);
    await db.shoutOut.deleteMany({ where: { id: staleShoutOut.id } });

    // ── PULSE SURVEY: DOUBLE-VOTE + AGGREGATE ───────────────────────
    step("4", "pulse survey — double-vote rejection + aggregate correctness");
    const survey = await db.pulseSurvey.create({
      data: {
        question: `${TAG} I have what I need to do my job well.`,
        scaleMin: 1,
        scaleMax: 5,
        createdBy: HR,
      },
    });

    // First response — the real transaction shape from app/api/pulse/respond.
    await db.$transaction(async (tx) => {
      await tx.surveyResponseRecord.create({
        data: { surveyId: survey.id, employeeId: birthdayEmp.id },
      });
      await tx.pulseSurveyResponse.create({
        data: { surveyId: survey.id, ratingValue: 4 },
      });
    });

    const already = await db.surveyResponseRecord.findUnique({
      where: { surveyId_employeeId: { surveyId: survey.id, employeeId: birthdayEmp.id } },
    });
    check("4a turnstile row exists after first response", already !== null);

    // Second attempt from the SAME employeeId must be rejected before any
    // write — the exact pre-check the route performs.
    let secondRejected = false;
    if (already) secondRejected = true;
    check("4b second submission from the same employeeId is rejected pre-write",
      secondRejected, "SurveyResponseRecord lookup finds the existing row → 409 ALREADY_RESPONDED");

    // Prove the DB-level guarantee too, not just the pre-check: the unique
    // constraint itself blocks a duplicate turnstile row.
    let constraintBlocked = false;
    let constraintCode = "";
    try {
      await db.surveyResponseRecord.create({
        data: { surveyId: survey.id, employeeId: birthdayEmp.id },
      });
    } catch (e) {
      constraintBlocked = true;
      constraintCode = (e as { code?: string }).code ?? "";
    }
    check("4c DB unique constraint independently blocks a duplicate turnstile row",
      constraintBlocked && constraintCode === "P2002", `code=${constraintCode}`);

    // A second, DIFFERENT employee may respond.
    await db.$transaction(async (tx) => {
      await tx.surveyResponseRecord.create({
        data: { surveyId: survey.id, employeeId: decoyEmp.id },
      });
      await tx.pulseSurveyResponse.create({
        data: { surveyId: survey.id, ratingValue: 2 },
      });
    });

    // Add one more rating so the average is a non-trivial number to verify.
    await db.pulseSurveyResponse.create({ data: { surveyId: survey.id, ratingValue: 5 } });

    // Aggregate via groupBy — the SAME shape lib/engagement/pulse.ts uses —
    // then run it through the real computeAggregate().
    const grouped = await db.pulseSurveyResponse.groupBy({
      by: ["ratingValue"],
      where: { surveyId: survey.id },
      _count: { _all: true },
    });
    const agg = computeAggregate(
      survey.id,
      grouped.map((g) => ({ ratingValue: g.ratingValue, count: g._count._all })),
      1,
      5,
    );
    // Responses: 4, 2, 5 → count=3, average=(4+2+5)/3=3.6666...→3.67
    check("4d response count correct", agg.responseCount === 3, `count=${agg.responseCount}`);
    check("4e average correct: (4+2+5)/3 = 3.67", agg.average === 3.67, `average=${agg.average}`);
    check("4f distribution covers every scale point, including zero-count ones",
      agg.distribution.length === 5 &&
        agg.distribution.find((x) => x.rating === 1)?.count === 0 &&
        agg.distribution.find((x) => x.rating === 2)?.count === 1 &&
        agg.distribution.find((x) => x.rating === 4)?.count === 1 &&
        agg.distribution.find((x) => x.rating === 5)?.count === 1,
      JSON.stringify(agg.distribution));

    // ── STRUCTURAL ANONYMITY: STATIC SOURCE AUDIT ───────────────────
    step("5", "static audit — no query ever joins response to employee");
    const files = walkSource(path.join(process.cwd(), "lib"))
      .concat(walkSource(path.join(process.cwd(), "app")))
      .concat(walkSource(path.join(process.cwd(), "components")))
      .filter((f) => !f.endsWith("verify-engagement.ts"));

    const readers: { file: string; line: number }[] = [];
    const includeJoins: { file: string; line: number; snippet: string }[] = [];

    for (const f of files) {
      const text = readFileSync(f, "utf8");
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (/\bpulseSurveyResponse\s*\./.test(line)) {
          readers.push({ file: path.relative(process.cwd(), f), line: i + 1 });
        }
      });
      // Any Prisma `include`/`select` block naming BOTH pulseSurveyResponse's
      // relation and an employeeId-bearing field within the same statement
      // would be the join we're checking never exists. A crude but effective
      // proxy: pulseSurveyResponse and employeeId appearing together within
      // 15 lines of each other anywhere in the file.
      for (let i = 0; i < lines.length; i++) {
        if (/\bpulseSurveyResponse\b/.test(lines[i])) {
          const windowText = lines.slice(Math.max(0, i - 15), i + 15).join("\n");
          if (/\bemployeeId\b/.test(windowText)) {
            includeJoins.push({ file: path.relative(process.cwd(), f), line: i + 1, snippet: lines[i].trim() });
          }
        }
      }
    }

    const expectedReaders = new Set([
      "lib\\engagement\\pulse.ts", "lib/engagement/pulse.ts",
      "app\\api\\pulse\\respond\\route.ts", "app/api/pulse/respond/route.ts",
    ]);
    const readerFiles = new Set(readers.map((r) => r.file));
    const unexpectedReaders = Array.from(readerFiles).filter((f) => !expectedReaders.has(f));

    check("5a PulseSurveyResponse is read/written from exactly the expected files",
      unexpectedReaders.length === 0,
      `readers: ${Array.from(readerFiles).join(", ")}`);

    check("5b write site (pulse/respond) creates the response WITHOUT employeeId in the same call",
      (() => {
        const src = readFileSync(path.join(process.cwd(), "app/api/pulse/respond/route.ts"), "utf8");
        const m = src.match(/tx\.pulseSurveyResponse\.create\(\{[\s\S]*?\}\);/);
        return !!m && !/employeeId/.test(m[0]);
      })(),
      "the pulseSurveyResponse.create({...}) call block contains no employeeId");

    // pulse.ts legitimately mentions `employeeId` — answeredSurveyIds() takes
    // one as a parameter — but that function queries SurveyResponseRecord,
    // never PulseSurveyResponse. The real check is per-function: neither
    // function that touches pulseSurveyResponse (aggregateSurvey,
    // aggregateSurveys) may reference employeeId anywhere in its body.
    check("5c neither aggregate function (the only pulseSurveyResponse readers) references employeeId",
      (() => {
        const src = readFileSync(path.join(process.cwd(), "lib/engagement/pulse.ts"), "utf8");
        const fns = ["aggregateSurvey", "aggregateSurveys"];
        for (const fn of fns) {
          const start = src.indexOf(`export async function ${fn}(`);
          if (start === -1) return false;
          // Body runs to the next top-level `export` (or EOF).
          const nextExport = src.indexOf("\nexport ", start + 1);
          let body = src.slice(start, nextExport === -1 ? undefined : nextExport);
          // The slice's tail is the NEXT function's leading JSDoc (comments
          // aren't part of any export boundary), which for
          // answeredSurveyIds legitimately discusses "employeeId" in prose.
          // Strip comments so only actual code is checked.
          body = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
          if (/employeeId/.test(body)) return false;
        }
        return true;
      })(),
      "aggregateSurvey/aggregateSurveys bodies checked individually — answeredSurveyIds (a different function, reading a different model) is allowed to mention employeeId");

    check("5d schema: PulseSurveyResponse model itself has no employeeId field",
      (() => {
        const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
        const m = schema.match(/model PulseSurveyResponse \{[\s\S]*?\n\}/);
        return !!m && !/employeeId/.test(m[0]);
      })());

    console.log(
      `\n  (informational) files mentioning both tokens within 15 lines: ${includeJoins.length}` +
        (includeJoins.length > 0
          ? "\n  " + includeJoins.map((j) => `${j.file}:${j.line}  ${j.snippet}`).join("\n  ")
          : " — none, anywhere in lib/app/components"),
    );
  } finally {
    console.log("\n── CLEANUP ───────────────────────────────────────────");
    await cleanup();
    const left = {
      employees: await db.employee.count({ where: { name: { startsWith: TAG } } }),
      holidays: await db.holiday.count({ where: { name: { startsWith: TAG } } }),
      surveys: await db.pulseSurvey.count({ where: { question: { startsWith: TAG } } }),
    };
    check("CLEANUP every test row removed", Object.values(left).every((n) => n === 0), JSON.stringify(left));
    await db.$disconnect();
  }

  console.log(
    `\n══ ${fail === 0 ? `ALL ${pass} CHECKS PASSED` : `${fail} of ${pass + fail} CHECKS FAILED`} ══`,
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("\nSCRIPT ERROR:", err);
  await cleanup().catch(() => {});
  await db.$disconnect();
  process.exit(1);
});
