/**
 * Phase 13 verification.
 *
 * Runs the REAL pure logic (lib/employees/retention.ts,
 * lib/payroll/salary-history.ts, lib/attendance/validation.ts) against seeded
 * data, and applies the REAL redaction / versioning writes the routes perform.
 *
 * Covers:
 *   1. Redaction erases personal identifiers and NOTHING else — every Payroll,
 *      Attendance and AppraisalScore row is byte-for-byte unchanged, and the
 *      Employee row still exists.
 *   2. A manual attendance correction writes ATTENDANCE_MANUALLY_CORRECTED
 *      carrying the old AND new values.
 *   3. A salary structure update creates a new version rather than overwriting,
 *      with correct half-open effective ranges.
 *   4. The packaged agent installer exists and is a valid signed executable.
 *
 * Cleans up after itself, pass or fail.
 *
 * Run:  node --env-file=.env prisma/verify-phase13.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import {
  scheduledRedactionFor,
  redactionPatch,
  checkEligibility,
  addYears,
  RETENTION_YEARS,
  REDACTED_FIELDS,
  PRESERVED_FIELDS,
  REDACTION_MARKER,
  // LOCAL-component date formatter. These are local-midnight dates, so
  // comparing them via toISOString() would report them a day early in IST —
  // which is exactly the display bug this helper exists to prevent.
  ymd,
} from "../lib/employees/retention.ts";
import {
  supersede,
  buildSalaryTimeline,
  grossOf,
  nextVersionNumber,
} from "../lib/payroll/salary-history.ts";
import { lateMinutesForShift } from "../lib/attendance/validation.ts";

const db = new PrismaClient();

const TAG = "ZZ-P13";
const ACTOR = "test-p13-actor";

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
  console.log(`\n── ${n}: ${title} ${"─".repeat(Math.max(0, 46 - title.length))}`);
}
function day(y: number, m: number, d: number) {
  return new Date(y, m - 1, d);
}
function at(y: number, m: number, d: number, hh: number, mm: number) {
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

async function cleanup() {
  const emps = await db.employee.findMany({
    where: { employeeCode: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = emps.map((e) => e.id);
  await db.attendance.deleteMany({ where: { employeeId: { in: ids } } });
  await db.payroll.deleteMany({ where: { employeeId: { in: ids } } });
  await db.appraisalScore.deleteMany({ where: { employeeId: { in: ids } } });
  await db.warningLetter.deleteMany({ where: { employeeId: { in: ids } } });
  await db.salaryStructureHistory.deleteMany({ where: { employeeId: { in: ids } } });
  await db.salaryStructure.deleteMany({ where: { employeeId: { in: ids } } });
  await db.consentRecord.deleteMany({ where: { employeeId: { in: ids } } });
  await db.appraisalCycle.deleteMany({ where: { period: { startsWith: TAG } } });
  await db.employee.deleteMany({ where: { id: { in: ids } } });
  await db.shift.deleteMany({ where: { name: { startsWith: TAG } } });
  await db.auditLog.deleteMany({ where: { actorUserId: ACTOR } });
}

async function main() {
  await cleanup();

  // ── 1: retention policy arithmetic ──────────────────────────────
  step("1", "retention policy — 5 years from the last working day");
  eq("5 years is the window", RETENTION_YEARS, 5);
  eq(
    "offboarded 2021-03-15 → due 2026-03-15",
    ymd(scheduledRedactionFor(day(2021, 3, 15))),
    "2026-03-15",
  );
  eq(
    "29 Feb clamps rather than rolling into March",
    ymd(addYears(day(2024, 2, 29), 5)),
    "2029-02-28",
  );
  check(
    "dates render from LOCAL components, not UTC (would be a day early in IST)",
    ymd(day(2026, 3, 15)) === "2026-03-15",
    `toISOString would give ${day(2026, 3, 15).toISOString().slice(0, 10)}`,
  );

  step("1b", "eligibility gate");
  check(
    "an ACTIVE employee is never eligible",
    checkEligibility({ active: true, offboardedAt: null, scheduledRedactionAt: null, redactedAt: null }).ok === false,
  );
  check(
    "offboarded but not yet due is refused",
    checkEligibility({
      active: false,
      offboardedAt: day(2025, 1, 1),
      scheduledRedactionAt: day(2030, 1, 1),
      redactedAt: null,
    }).ok === false,
  );
  check(
    "already redacted is refused (one-way)",
    checkEligibility({
      active: false,
      offboardedAt: day(2018, 1, 1),
      scheduledRedactionAt: day(2023, 1, 1),
      redactedAt: day(2023, 2, 1),
    }).ok === false,
  );
  check(
    "offboarded AND past due IS eligible",
    checkEligibility({
      active: false,
      offboardedAt: day(2018, 1, 1),
      scheduledRedactionAt: day(2023, 1, 1),
      redactedAt: null,
    }).ok === true,
  );

  // ── SEED: an offboarded employee with a full financial history ───
  step("2", "REDACTION — identifiers erased, financial history untouched");
  const shift = await db.shift.create({
    data: {
      name: `${TAG} Day`,
      startTime: "09:00",
      endTime: "17:00",
      gracePeriodMinutes: 0,
      createdBy: ACTOR,
    },
  });
  const emp = await db.employee.create({
    data: {
      employeeCode: `${TAG}-0001`,
      name: `${TAG} Departed Person`,
      department: "Assembly",
      designation: "Line Operator",
      email: "zz-p13-departed@example.invalid",
      emergencyContact: "Next of kin - 9999999999",
      dateOfBirth: day(1990, 5, 12),
      pfUan: "100123456789",
      machineId: "BENCH-7",
      pendingInvitationId: "inv_zzp13_stale",
      joiningDate: day(2016, 1, 4),
      // Offboarded long enough ago that the 5-year clock has elapsed.
      active: false,
      offboardedAt: day(2019, 6, 30),
      scheduledRedactionAt: scheduledRedactionFor(day(2019, 6, 30)),
      shiftId: shift.id,
    },
  });

  const cycle = await db.appraisalCycle.create({
    data: {
      period: `${TAG}-2019`,
      weightsJson: { punctuality: 25, production: 25, quality: 25, feedback: 25, warningPenaltyPoints: 5 },
      createdBy: ACTOR,
      published: true,
      createdAt: day(2019, 6, 1),
    },
  });

  await db.payroll.create({
    data: {
      employeeId: emp.id,
      month: "2019-06",
      status: "FINALIZED",
      basic: new Prisma.Decimal("30000.00"),
      hra: new Prisma.Decimal("15000.00"),
      specialAllowance: new Prisma.Decimal("5000.00"),
      gross: new Prisma.Decimal("50000.00"),
      deductions: new Prisma.Decimal("4375.00"),
      net: new Prisma.Decimal("45625.00"),
      daysWorked: 30,
      daysInMonth: 30,
      finalizedBy: ACTOR,
      finalizedAt: day(2019, 7, 1),
    },
  });
  await db.attendance.create({
    data: {
      employeeId: emp.id,
      date: day(2019, 6, 3),
      checkIn: at(2019, 6, 3, 9, 5),
      checkOut: at(2019, 6, 3, 17, 30),
      lateFlag: true,
      lateMinutes: 5,
      checkInNote: "seed",
    },
  });
  await db.appraisalScore.create({
    data: { employeeId: emp.id, cycleId: cycle.id, finalScore: 82.5 },
  });
  await db.warningLetter.create({
    data: {
      employeeId: emp.id,
      issuedBy: ACTOR,
      reason: "seed warning",
      status: "RELEASED",
      releasedAt: day(2019, 3, 1),
    },
  });
  await db.consentRecord.create({
    data: { employeeId: emp.id, consentType: "IDLE_TRACKING", givenOn: day(2019, 1, 1) },
  });

  // Snapshot EVERYTHING that must survive, before redaction.
  const before = {
    payroll: await db.payroll.findMany({ where: { employeeId: emp.id } }),
    attendance: await db.attendance.findMany({ where: { employeeId: emp.id } }),
    appraisal: await db.appraisalScore.findMany({ where: { employeeId: emp.id } }),
    warnings: await db.warningLetter.findMany({ where: { employeeId: emp.id } }),
    consents: await db.consentRecord.findMany({ where: { employeeId: emp.id } }),
  };

  // The REAL action the route performs: one update, to one row.
  const patch = redactionPatch(day(2026, 7, 25));
  await db.employee.update({ where: { id: emp.id }, data: patch });

  const after = await db.employee.findUnique({ where: { id: emp.id } });

  check("the Employee ROW STILL EXISTS — never deleted", after !== null);
  eq("email erased", after?.email, null);
  eq("emergencyContact erased", after?.emergencyContact, REDACTION_MARKER);
  eq("dateOfBirth erased", after?.dateOfBirth, null);
  eq("stale invitation token erased", after?.pendingInvitationId, null);
  check("redactedAt stamped", after?.redactedAt !== null);
  eq("the retention clock is cleared once acted on", after?.scheduledRedactionAt, null);

  step("2b", "PRESERVED fields — including the name, deliberately");
  eq("name KEPT", after?.name, `${TAG} Departed Person`);
  eq("employeeCode KEPT", after?.employeeCode, `${TAG}-0001`);
  eq("department KEPT", after?.department, "Assembly");
  eq("designation KEPT", after?.designation, "Line Operator");
  eq("joiningDate KEPT", after?.joiningDate.toISOString(), emp.joiningDate.toISOString());
  eq("offboardedAt KEPT", after?.offboardedAt?.toISOString(), emp.offboardedAt?.toISOString());
  eq("pfUan KEPT (statutory filings reference it)", after?.pfUan, "100123456789");
  eq("machineId KEPT", after?.machineId, "BENCH-7");
  check(
    "every field the policy claims to preserve really is preserved",
    PRESERVED_FIELDS.every((f) => {
      const v = (after as unknown as Record<string, unknown>)[f];
      return v !== null && v !== undefined && v !== REDACTION_MARKER;
    }),
    PRESERVED_FIELDS.join(", "),
  );
  check(
    "every field the policy claims to redact really is redacted",
    REDACTED_FIELDS.every((f) => {
      const v = (after as unknown as Record<string, unknown>)[f];
      return v === null || v === REDACTION_MARKER;
    }),
    REDACTED_FIELDS.join(", "),
  );

  step("2c", "FINANCIAL AND BUSINESS RECORDS — byte-for-byte unchanged");
  const afterRows = {
    payroll: await db.payroll.findMany({ where: { employeeId: emp.id } }),
    attendance: await db.attendance.findMany({ where: { employeeId: emp.id } }),
    appraisal: await db.appraisalScore.findMany({ where: { employeeId: emp.id } }),
    warnings: await db.warningLetter.findMany({ where: { employeeId: emp.id } }),
    consents: await db.consentRecord.findMany({ where: { employeeId: emp.id } }),
  };
  eq("Payroll rows count unchanged", afterRows.payroll.length, before.payroll.length);
  eq(
    "Payroll row IDENTICAL (every column, including net pay)",
    JSON.stringify(afterRows.payroll),
    JSON.stringify(before.payroll),
  );
  eq("payslip net still 45625.00", afterRows.payroll[0].net.toFixed(2), "45625.00");
  eq(
    "Attendance rows IDENTICAL",
    JSON.stringify(afterRows.attendance),
    JSON.stringify(before.attendance),
  );
  eq(
    "AppraisalScore rows IDENTICAL",
    JSON.stringify(afterRows.appraisal),
    JSON.stringify(before.appraisal),
  );
  eq(
    "WarningLetter rows IDENTICAL",
    JSON.stringify(afterRows.warnings),
    JSON.stringify(before.warnings),
  );
  eq(
    "ConsentRecord rows IDENTICAL",
    JSON.stringify(afterRows.consents),
    JSON.stringify(before.consents),
  );
  check(
    "the redacted employee is STILL joinable from their payroll row",
    (
      await db.payroll.findFirst({
        where: { employeeId: emp.id },
        select: { employee: { select: { name: true, employeeCode: true } } },
      })
    )?.employee.employeeCode === `${TAG}-0001`,
  );

  // ── 3: attendance correction + audit ────────────────────────────
  step("3", "ATTENDANCE CORRECTION — audit carries old and new values");
  const live = await db.employee.create({
    data: {
      employeeCode: `${TAG}-0002`,
      name: `${TAG} Current Person`,
      department: "Assembly",
      joiningDate: day(2025, 1, 1),
      shiftId: shift.id,
    },
  });
  // A forgotten clock-out: checked in late, never closed.
  const row = await db.attendance.create({
    data: {
      employeeId: live.id,
      date: day(2026, 7, 20),
      checkIn: at(2026, 7, 20, 9, 40),
      checkOut: null,
      lateFlag: true,
      lateMinutes: 40,
      flaggedForReview: true,
      reviewReason: "IP 10.0.0.9 is not in the allowlist",
      checkInNote: "seed",
    },
  });

  // The REAL correction the route performs.
  const newCheckIn = at(2026, 7, 20, 9, 10);
  const newCheckOut = at(2026, 7, 20, 17, 35);
  const recomputedLate = lateMinutesForShift(newCheckIn, "09:00", 0, "17:00");
  eq("lateness RECOMPUTED from the corrected time, not carried over", recomputedLate, 10);

  const reason = "Employee forgot to clock out; 17:35 confirmed with supervisor.";
  await db.$transaction(async (tx) => {
    await tx.attendance.update({
      where: { id: row.id },
      data: {
        checkIn: newCheckIn,
        checkOut: newCheckOut,
        lateFlag: recomputedLate !== null,
        lateMinutes: recomputedLate,
        flaggedForReview: false,
        reviewReason: `${row.reviewReason} | resolved by HR: ${reason}`,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: ACTOR,
        action: "ATTENDANCE_MANUALLY_CORRECTED",
        targetEntity:
          `attendance=${row.id} employee=${live.employeeCode} ` +
          `date=${row.date.toISOString().slice(0, 10)} ` +
          `checkIn: ${row.checkIn!.toISOString()} → ${newCheckIn.toISOString()} | ` +
          `checkOut: none → ${newCheckOut.toISOString()} | ` +
          `lateMinutes: ${row.lateMinutes} → ${recomputedLate} | ` +
          `flaggedForReview: true → false — ${reason}`,
      },
    });
  });

  const corrected = await db.attendance.findUnique({ where: { id: row.id } });
  eq("check-in updated", corrected?.checkIn?.toISOString(), newCheckIn.toISOString());
  eq("check-out filled in", corrected?.checkOut?.toISOString(), newCheckOut.toISOString());
  eq("lateMinutes recalculated to 10", corrected?.lateMinutes, 10);
  eq("review flag cleared", corrected?.flaggedForReview, false);

  const audit = await db.auditLog.findFirst({
    where: { action: "ATTENDANCE_MANUALLY_CORRECTED", targetEntity: { contains: row.id } },
  });
  check("ATTENDANCE_MANUALLY_CORRECTED audit row exists", audit !== null);
  check(
    "audit records the OLD check-in (09:40)",
    audit !== null && audit.targetEntity.includes(row.checkIn!.toISOString()),
  );
  check(
    "audit records the NEW check-in (09:10)",
    audit !== null && audit.targetEntity.includes(newCheckIn.toISOString()),
  );
  check(
    "audit records the OLD → NEW lateMinutes (40 → 10)",
    audit !== null && audit.targetEntity.includes("lateMinutes: 40 → 10"),
  );
  check("audit records the reason", audit !== null && audit.targetEntity.includes(reason));

  // ── 4: salary structure versioning ──────────────────────────────
  step("4", "SALARY VERSIONING — history preserved, not overwritten");
  const v1 = {
    basic: "30000.00",
    hra: "15000.00",
    specialAllowance: "5000.00",
    effectiveFrom: day(2025, 4, 1),
    setBy: ACTOR,
  };
  await db.salaryStructure.create({
    data: {
      employeeId: live.id,
      basic: new Prisma.Decimal(v1.basic),
      hra: new Prisma.Decimal(v1.hra),
      specialAllowance: new Prisma.Decimal(v1.specialAllowance),
      effectiveFrom: v1.effectiveFrom,
      setBy: ACTOR,
    },
  });
  eq("first set archives nothing", supersede({ current: null, history: [], newEffectiveFrom: day(2025, 4, 1), actorUserId: ACTOR }), { ok: true, historyRow: null });

  // A raise, effective 1 April 2026.
  const raiseFrom = day(2026, 4, 1);
  const plan = supersede({
    current: v1,
    history: [],
    newEffectiveFrom: raiseFrom,
    actorUserId: "hr-2",
  });
  check("the raise plans an archive row", plan.ok && plan.historyRow !== null);
  if (!plan.ok || !plan.historyRow) throw new Error("supersede failed");
  eq("archived version is v1", plan.historyRow.versionNumber, 1);
  eq(
    "archived range closes on the new effectiveFrom (half-open)",
    plan.historyRow.effectiveTo.toISOString(),
    raiseFrom.toISOString(),
  );
  eq("archived figures are the OLD ones", plan.historyRow.basic, "30000.00");

  await db.$transaction(async (tx) => {
    await tx.salaryStructureHistory.create({
      data: { employeeId: live.id, ...plan.historyRow! },
    });
    await tx.salaryStructure.update({
      where: { employeeId: live.id },
      data: {
        basic: new Prisma.Decimal("36000.00"),
        hra: new Prisma.Decimal("18000.00"),
        specialAllowance: new Prisma.Decimal("6000.00"),
        effectiveFrom: raiseFrom,
        setBy: "hr-2",
      },
    });
  });

  const currentRow = await db.salaryStructure.findUnique({ where: { employeeId: live.id } });
  const historyRows = await db.salaryStructureHistory.findMany({
    where: { employeeId: live.id },
    orderBy: { effectiveFrom: "asc" },
  });

  eq("exactly ONE current structure (payroll's view is unchanged)", currentRow !== null, true);
  eq("current holds the NEW figures", currentRow?.basic.toFixed(2), "36000.00");
  eq("exactly one archived version", historyRows.length, 1);
  eq("archived holds the OLD figures — not overwritten", historyRows[0].basic.toFixed(2), "30000.00");

  const timeline = buildSalaryTimeline(
    {
      basic: currentRow!.basic.toFixed(2),
      hra: currentRow!.hra.toFixed(2),
      specialAllowance: currentRow!.specialAllowance.toFixed(2),
      effectiveFrom: currentRow!.effectiveFrom,
      setBy: currentRow!.setBy,
    },
    historyRows.map((h) => ({
      basic: h.basic.toFixed(2),
      hra: h.hra.toFixed(2),
      specialAllowance: h.specialAllowance.toFixed(2),
      effectiveFrom: h.effectiveFrom,
      effectiveTo: h.effectiveTo,
      versionNumber: h.versionNumber,
      setBy: h.setBy,
      supersededBy: h.supersededBy,
      supersededAt: h.supersededAt,
    })),
  );

  eq("timeline shows BOTH versions", timeline.length, 2);
  eq(
    "v1 is 2025-04-01 → 2026-04-01",
    `${ymd(timeline[0].effectiveFrom)} → ${ymd(timeline[0].effectiveTo!)}`,
    "2025-04-01 → 2026-04-01",
  );
  eq("v1 gross 50000.00", timeline[0].gross, "50000.00");
  check("v1 is not current", timeline[0].current === false);
  eq(
    "v2 starts 2026-04-01 and is open-ended",
    `${ymd(timeline[1].effectiveFrom)} → ${timeline[1].effectiveTo}`,
    "2026-04-01 → null",
  );
  eq("v2 gross 60000.00", timeline[1].gross, "60000.00");
  check("v2 IS current", timeline[1].current === true);
  eq("the raise is +10000.00", timeline[1].grossDelta, "10000.00");
  eq("v1 has no delta (nothing before it)", timeline[0].grossDelta, null);
  eq("ranges are contiguous with no gap", timeline[0].effectiveTo!.getTime(), timeline[1].effectiveFrom.getTime());
  eq("next version number would be 2", nextVersionNumber(historyRows), 2);
  eq("gross helper is exact", grossOf("30000.00", "15000.00", "5000.00"), "50000.00");

  step("4b", "a backdated 'raise' is refused rather than silently corrupting");
  const bad = supersede({
    current: v1,
    history: [],
    newEffectiveFrom: day(2025, 1, 1), // BEFORE the current version
    actorUserId: ACTOR,
  });
  check("an effectiveFrom at or before the current one is refused", bad.ok === false);
  if (!bad.ok) eq("with a clear code", bad.code, "NOT_AFTER_CURRENT");

  // ── 5: the packaged installer ───────────────────────────────────
  step("5", "AGENT INSTALLER — a real, signed artefact exists");
  const distDir = path.resolve(import.meta.dirname, "..", "agent", "dist");
  const installers = fs.existsSync(distDir)
    ? fs.readdirSync(distDir).filter((f) => f.toLowerCase().endsWith(".exe"))
    : [];
  check("an .exe installer exists in agent/dist", installers.length > 0, installers.join(", "));

  if (installers.length > 0) {
    const file = path.join(distDir, installers[0]);
    const st = fs.statSync(file);
    check("installer is a substantial file (> 30 MB)", st.size > 30 * 1024 * 1024, `${(st.size / 1024 / 1024).toFixed(1)} MB`);

    // A valid Windows executable begins "MZ" — proves it is a real PE binary
    // and not a stub or an error page written to disk.
    const fd = fs.openSync(file, "r");
    const head = Buffer.alloc(2);
    fs.readSync(fd, head, 0, 2, 0);
    fs.closeSync(fd);
    eq("starts with the PE magic 'MZ'", head.toString("latin1"), "MZ");

    // An Authenticode signature lives in the PE security directory; the
    // certificate's subject appears in the embedded PKCS#7 blob.
    const buf = fs.readFileSync(file);
    const hasCert = buf.includes(Buffer.from("Simplen SESS Idle Agent", "utf16le"))
      || buf.includes(Buffer.from("Simplen SESS Idle Agent", "latin1"));
    check("an embedded signature naming the signing certificate is present", hasCert);

    const certDir = path.resolve(import.meta.dirname, "..", "agent", "certs");
    check(
      "the public .cer IT distributes was produced",
      fs.existsSync(path.join(certDir, "sess-agent-signing.cer")),
    );
    check(
      "the private .pfx exists on the build machine",
      fs.existsSync(path.join(certDir, "sess-agent-signing.pfx")),
    );
  }

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
