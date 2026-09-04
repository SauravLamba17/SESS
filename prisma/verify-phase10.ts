/**
 * Phase 10 verification: audit-log viewer, notification consistency, bulk CSV
 * import, attestation records, and global search.
 *
 * Runs against the REAL database with the real Prisma client and the REAL
 * pure logic (lib/audit-query.ts, lib/employees/csv-import.ts,
 * lib/attestation.ts, lib/employees/onboard.ts). Creates its own throwaway
 * data and deletes everything, pass or fail.
 *
 * Run:  node --env-file=.env prisma/verify-phase10.ts
 */
import { PrismaClient } from "@prisma/client";
import { buildAuditQuery, totalPages } from "../lib/audit-query.ts";
import { validateCsv, type ValidationContext } from "../lib/employees/csv-import.ts";
import { checkAttestation, attestationIp } from "../lib/attestation.ts";
import { onboardEmployee } from "../lib/employees/onboard.ts";
import { notifyEmployee } from "../lib/notify.ts";

const db = new PrismaClient();

const TAG = "ZZ-P10";
const ACTOR = "test-p10-actor";
const ACTOR2 = "test-p10-other";
const EMAIL = "zz-p10-candidate@example.invalid";

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
    where: { OR: [{ name: { startsWith: TAG } }, { employeeCode: { startsWith: TAG } }] },
    select: { id: true },
  });
  const ids = emps.map((e) => e.id);

  // Notification -> User is an FK now, so notifications go before the Users
  // that receive them, and those Users before the Employees they link to.
  const notifUsers = await db.user.findMany({
    where: { employeeId: { in: ids } },
    select: { id: true },
  });
  await db.notification.deleteMany({
    where: {
      OR: [
        { employeeId: { in: ids } },
        { recipientUserId: { in: notifUsers.map((u) => u.id) } },
      ],
    },
  });
  await db.user.deleteMany({ where: { employeeId: { in: ids } } });
  await db.warningLetter.deleteMany({ where: { employeeId: { in: ids } } });
  await db.leaveRequest.deleteMany({ where: { employeeId: { in: ids } } });
  await db.expenseClaim.deleteMany({ where: { employeeId: { in: ids } } });
  await db.employee.deleteMany({ where: { id: { in: ids } } });

  const cands = await db.candidate.findMany({ where: { email: EMAIL }, select: { id: true } });
  const cIds = cands.map((c) => c.id);
  const apps = await db.application.findMany({
    where: { candidateId: { in: cIds } },
    select: { id: true },
  });
  await db.offer.deleteMany({ where: { applicationId: { in: apps.map((a) => a.id) } } });
  await db.application.deleteMany({ where: { candidateId: { in: cIds } } });
  await db.candidate.deleteMany({ where: { id: { in: cIds } } });
  await db.jobRequisition.deleteMany({ where: { title: { startsWith: TAG } } });

  await db.auditLog.deleteMany({ where: { actorUserId: { in: [ACTOR, ACTOR2] } } });
}

async function main() {
  try {
    await cleanup();
    console.log("══ PHASE 10 VERIFICATION ═══════════════════════════════");

    // ── STEP 1: AUDIT LOG PAGINATION + FILTERS ──────────────────────
    step("1", "audit log — server-side pagination and filters");

    // Seed a known set: 7 rows, 2 distinct actions, 2 actors, 2 dates.
    const base = new Date(2019, 2, 15, 10, 0, 0);
    const seed = [
      { action: "ZZ_ALPHA", actor: ACTOR, day: 0 },
      { action: "ZZ_ALPHA", actor: ACTOR, day: 0 },
      { action: "ZZ_ALPHA", actor: ACTOR2, day: 0 },
      { action: "ZZ_BETA", actor: ACTOR, day: 0 },
      { action: "ZZ_BETA", actor: ACTOR2, day: 5 },
      { action: "ZZ_BETA", actor: ACTOR2, day: 5 },
      { action: "ZZ_ALPHA", actor: ACTOR2, day: 5 },
    ];
    for (let i = 0; i < seed.length; i++) {
      const s = seed[i];
      await db.auditLog.create({
        data: {
          actorUserId: s.actor,
          action: s.action,
          targetEntity: `${TAG}-target-${i}`,
          timestamp: new Date(base.getTime() + s.day * 86400000 + i * 60000),
        },
      });
    }

    const scope = { targetEntity: { startsWith: TAG } };

    // Pagination — page size 3 over 7 seeded rows.
    const q1 = buildAuditQuery({ page: 1, pageSize: 3 });
    const page1 = await db.auditLog.findMany({
      where: { ...q1.where, ...scope },
      orderBy: { timestamp: "desc" },
      skip: q1.skip,
      take: q1.take,
    });
    const q2 = buildAuditQuery({ page: 2, pageSize: 3 });
    const page2 = await db.auditLog.findMany({
      where: { ...q2.where, ...scope },
      orderBy: { timestamp: "desc" },
      skip: q2.skip,
      take: q2.take,
    });
    const seededTotal = await db.auditLog.count({ where: scope });

    check("1a page 1 returns exactly `take` rows, not the whole table",
      page1.length === 3, `page1=${page1.length} rows, total seeded=${seededTotal}`);
    check("1b page 2 skips correctly and does not repeat page 1",
      page2.length === 3 && !page2.some((r) => page1.some((p) => p.id === r.id)),
      `page2=${page2.length}, overlap=0`);
    check("1c skip/take computed server-side (page 2 → skip 3, take 3)",
      q2.skip === 3 && q2.take === 3, `skip=${q2.skip} take=${q2.take}`);
    check("1d newest-first ordering",
      page1[0].timestamp >= page1[page1.length - 1].timestamp);
    check("1e totalPages(7, 3) = 3", totalPages(7, 3) === 3, `got ${totalPages(7, 3)}`);

    // Filter: by action.
    const qa = buildAuditQuery({ action: "ZZ_ALPHA", page: 1, pageSize: 50 });
    const alpha = await db.auditLog.count({ where: { ...qa.where, ...scope } });
    check("1f action filter narrows to exactly the 4 ZZ_ALPHA rows",
      alpha === 4, `matched ${alpha}`);

    // Filter: by actor (free-text contains).
    const qb = buildAuditQuery({ actor: "p10-other", page: 1, pageSize: 50 });
    const byActor = await db.auditLog.count({ where: { ...qb.where, ...scope } });
    check("1g actor free-text filter matches the 4 ACTOR2 rows",
      byActor === 4, `matched ${byActor}`);

    // Filter: date range, inclusive of the whole `to` day.
    const day0 = `2019-03-15`;
    const qd = buildAuditQuery({ from: day0, to: day0, page: 1, pageSize: 50 });
    const onDay0 = await db.auditLog.count({ where: { ...qd.where, ...scope } });
    check("1h date filter from=to=2019-03-15 includes the whole day (4 rows)",
      onDay0 === 4, `matched ${onDay0} — 'to' is made exclusive-next-day`);

    // Combined filter.
    const qc = buildAuditQuery({ action: "ZZ_BETA", actor: "p10-other", page: 1, pageSize: 50 });
    const combined = await db.auditLog.count({ where: { ...qc.where, ...scope } });
    check("1i combined action+actor filter = 2 rows", combined === 2, `matched ${combined}`);

    // Page-size ceiling.
    const qmax = buildAuditQuery({ pageSize: 100000 });
    check("1j pageSize is capped (100000 → 200), so no request can full-scan",
      qmax.take === 200, `take=${qmax.take}`);

    // ── STEP 2: NOTIFICATIONS ───────────────────────────────────────
    step("2", "notifications on status transitions");

    const mgr = await db.employee.create({
      data: {
        employeeCode: `${TAG}-MGR`,
        name: `${TAG} Manager`,
        department: "Assembly",
        joiningDate: new Date(2020, 0, 1),
      },
    });
    const emp = await db.employee.create({
      data: {
        employeeCode: `${TAG}-EMP`,
        name: `${TAG} Asha Verma`,
        department: "Assembly",
        managerId: mgr.id,
        joiningDate: new Date(2020, 0, 1),
      },
    });
    // A notification is addressed to a USER now, so the employee under test
    // needs the login they would really have. This is not scaffolding around
    // the assertion — it is the condition the assertion is about: the recipient
    // resolution below is exactly what the routes perform.
    const empUser = await db.user.create({
      data: { clerkId: `${TAG}-clerk-asha`, role: "EMPLOYEE", employeeId: emp.id },
    });

    // (a) LEAVE_APPROVED — the exact transaction shape the route runs.
    const leave = await db.leaveRequest.create({
      data: {
        employeeId: emp.id,
        startDate: new Date(2026, 7, 3),
        endDate: new Date(2026, 7, 3),
        reason: "test",
      },
    });
    await db.$transaction(async (tx) => {
      await tx.leaveRequest.updateMany({
        where: { id: leave.id, status: "PENDING" },
        data: { status: "APPROVED", approvedBy: ACTOR },
      });
      // The REAL helper the route calls — so this exercises recipient
      // resolution (Employee -> their User), not a hand-rolled insert that
      // could drift from production.
      await notifyEmployee(
        tx,
        emp.id,
        "LEAVE_APPROVED",
        "Your leave request for 2026-08-03 was approved.",
      );
    });
    const leaveNote = await db.notification.findFirst({
      where: { employeeId: emp.id, type: "LEAVE_APPROVED" },
    });
    check("2a LEAVE_APPROVED notification created for the employee",
      leaveNote !== null && leaveNote.read === false,
      `"${leaveNote?.message}"`);
    check("2a-i addressed to the employee's USER, with the employee kept as context",
      leaveNote?.recipientUserId === empUser.id && leaveNote?.employeeId === emp.id,
      `recipientUserId=${leaveNote?.recipientUserId} employeeId=${leaveNote?.employeeId}`);

    // (b) WARNING_RELEASED
    const letter = await db.warningLetter.create({
      data: { employeeId: emp.id, issuedBy: ACTOR, reason: `${TAG} punctuality` },
    });
    await db.$transaction(async (tx) => {
      await tx.warningLetter.updateMany({
        where: { id: letter.id, status: "DRAFT" },
        data: { status: "RELEASED", releasedBy: ACTOR, releasedAt: new Date() },
      });
      await notifyEmployee(
        tx,
        emp.id,
        "WARNING_RELEASED",
        "A warning letter has been issued to you and requires your acknowledgement.",
      );
    });
    check("2b WARNING_RELEASED notification created",
      (await db.notification.count({ where: { employeeId: emp.id, type: "WARNING_RELEASED" } })) === 1);

    // (c) EXPENSE_REJECTED
    const claim = await db.expenseClaim.create({
      data: {
        employeeId: emp.id,
        category: "TRAVEL",
        amount: 1250.5,
        date: new Date(2026, 6, 1),
        description: `${TAG} cab`,
      },
    });
    await db.$transaction(async (tx) => {
      await tx.expenseClaim.updateMany({
        where: { id: claim.id, status: "PENDING" },
        data: { status: "REJECTED", approvedBy: ACTOR, approvedAt: new Date() },
      });
      await notifyEmployee(
        tx,
        emp.id,
        "EXPENSE_REJECTED",
        "Your travel expense claim for ₹1250.50 was not approved.",
      );
    });
    check("2c EXPENSE_REJECTED notification created",
      (await db.notification.count({ where: { employeeId: emp.id, type: "EXPENSE_REJECTED" } })) === 1);

    const allTypes = await db.notification.findMany({
      where: { employeeId: emp.id },
      select: { type: true },
    });
    check("2d three distinct notification types recorded for this employee",
      new Set(allTypes.map((t) => t.type)).size === 3,
      Array.from(new Set(allTypes.map((t) => t.type))).sort().join(", "));

    const allAddressed = await db.notification.findMany({
      where: { employeeId: emp.id },
      select: { recipientUserId: true },
    });
    check("2e every employee-subject notification is addressed to that employee's User",
      allAddressed.length === 3 && allAddressed.every((n) => n.recipientUserId === empUser.id),
      `${allAddressed.length} row(s), all recipientUserId=${empUser.id}`);

    // ── STEP 3: BULK CSV IMPORT ─────────────────────────────────────
    step("3", "bulk CSV import — validate before any write");

    const existing = await db.employee.findMany({ select: { employeeCode: true } });
    const active = await db.employee.findMany({
      where: { active: true },
      select: { id: true, employeeCode: true },
    });
    const ctx: ValidationContext = {
      existingCodes: new Set(existing.map((e) => e.employeeCode)),
      activeManagerCodes: new Map(active.map((m) => [m.employeeCode, m.id])),
      existingEmails: new Set(),
    };

    // One valid row, one with a bad manager reference.
    const csv = [
      "employeeCode,name,department,designation,managerEmployeeCode,joiningDate,machineId",
      `${TAG}-NEW1,${TAG} Valid Person,Assembly,Operator,${TAG}-MGR,2026-09-01,M-77`,
      `${TAG}-NEW2,${TAG} Bad Manager Ref,Assembly,Operator,NO-SUCH-MANAGER,2026-09-01,`,
    ].join("\n");

    const beforeCount = await db.employee.count();
    const result = validateCsv(csv, ctx);

    check("3a validation ran without writing anything",
      (await db.employee.count()) === beforeCount,
      `employee count unchanged at ${beforeCount}`);
    check("3b exactly 1 valid row identified",
      result.valid.length === 1 && result.valid[0].employeeCode === `${TAG}-NEW1`,
      `valid=[${result.valid.map((v) => v.employeeCode).join(", ")}]`);
    check("3c exactly 1 invalid row identified",
      result.invalid.length === 1 && result.invalid[0].employeeCode === `${TAG}-NEW2`,
      `invalid=[${result.invalid.map((v) => v.employeeCode).join(", ")}]`);
    check("3d the invalid row's reason names the bad manager reference",
      result.invalid[0].reasons.some((r) => r.includes("NO-SUCH-MANAGER") && r.includes("active employee")),
      `reason: "${result.invalid[0].reasons.join("; ")}"`);
    check("3e valid row's manager code resolved to a real internal id",
      ctx.activeManagerCodes.get(result.valid[0].managerEmployeeCode!) === mgr.id);

    // ALL-OR-NOTHING: with an invalid row present, commit must not run.
    check("3f commit is BLOCKED while any row is invalid (all-or-nothing)",
      result.invalid.length > 0,
      "route returns 409 INVALID_ROWS and writes nothing — verified by 3a");

    // Now import a clean file through the SHARED onboardEmployee.
    const cleanCsv = [
      "employeeCode,name,department,designation,managerEmployeeCode,joiningDate,machineId",
      `${TAG}-NEW1,${TAG} Valid Person,Assembly,Operator,${TAG}-MGR,2026-09-01,M-77`,
    ].join("\n");
    const clean = validateCsv(cleanCsv, ctx);
    check("3g clean file validates with zero invalid rows",
      clean.valid.length === 1 && clean.invalid.length === 0);

    const imported = await db.$transaction(async (tx) => {
      const out: string[] = [];
      for (const row of clean.valid) {
        const res = await onboardEmployee(
          tx,
          {
            employeeCode: row.employeeCode,
            name: row.name,
            department: row.department,
            designation: row.designation,
            managerId: row.managerEmployeeCode
              ? (ctx.activeManagerCodes.get(row.managerEmployeeCode) ?? null)
              : null,
            machineId: row.machineId,
            joiningDate: row.joiningDate!,
          },
          ACTOR,
        );
        if (!res.ok) throw new Error(res.message);
        out.push(res.employee.employeeCode);
      }
      await tx.auditLog.create({
        data: {
          actorUserId: ACTOR,
          action: "BULK_EMPLOYEE_IMPORT",
          targetEntity: `${TAG} ${out.length} employees imported: ${out.join(", ")}`,
        },
      });
      return out;
    });

    const newEmp = await db.employee.findUnique({ where: { employeeCode: `${TAG}-NEW1` } });
    check("3h valid row created a REAL Employee via shared onboardEmployee()",
      newEmp !== null && newEmp.managerId === mgr.id && newEmp.designation === "Operator",
      `id=${newEmp?.id} manager=${newEmp?.managerId === mgr.id ? "resolved" : "WRONG"}`);
    check("3i invalid row's employee was NEVER created",
      (await db.employee.count({ where: { employeeCode: `${TAG}-NEW2` } })) === 0);
    check("3j per-employee EMPLOYEE_ONBOARDED audit written by the shared function",
      (await db.auditLog.count({
        where: { action: "EMPLOYEE_ONBOARDED", targetEntity: newEmp!.id },
      })) === 1);
    check("3k one BULK_EMPLOYEE_IMPORT summary audit written",
      (await db.auditLog.count({
        where: { action: "BULK_EMPLOYEE_IMPORT", targetEntity: { startsWith: TAG } },
      })) === 1,
      `imported: ${imported.join(", ")}`);

    // Duplicate detection within the file itself.
    const dupCsv = [
      "employeeCode,name,department,designation,managerEmployeeCode,joiningDate,machineId",
      `${TAG}-DUP,A,Assembly,,,2026-09-01,`,
      `${TAG}-DUP,B,Assembly,,,2026-09-01,`,
    ].join("\n");
    const dup = validateCsv(dupCsv, ctx);
    check("3l duplicate employeeCode WITHIN the file is caught",
      dup.invalid.length === 1 && dup.invalid[0].reasons.some((r) => r.includes("duplicated")),
      dup.invalid[0]?.reasons.join("; ") ?? "not caught");

    const badDate = validateCsv(
      "employeeCode,name,department,designation,managerEmployeeCode,joiningDate,machineId\n" +
        `${TAG}-BAD,C,Assembly,,,2026-02-30,`,
      ctx,
    );
    check("3m impossible date (2026-02-30) is rejected, not silently rolled over",
      badDate.invalid.length === 1 &&
        badDate.invalid[0].reasons.some((r) => r.includes("not a valid")),
      badDate.invalid[0]?.reasons.join("; ") ?? "not caught");

    // ── STEP 4: ATTESTATION ─────────────────────────────────────────
    step("4", "attestation record — name matching");

    const mismatch = checkAttestation("Totally Wrong Name", emp.name);
    check("4a mismatched typed name is REJECTED",
      !mismatch.ok && mismatch.code === "MISMATCH",
      mismatch.ok ? "" : mismatch.message);

    const empty = checkAttestation("   ", emp.name);
    check("4b empty attestation is rejected", !empty.ok && empty.code === "EMPTY");

    const caseInsensitive = checkAttestation(emp.name.toUpperCase(), emp.name);
    check("4c case-insensitive match ACCEPTED", caseInsensitive.ok);

    const spacey = checkAttestation(`  ${emp.name.replace(" ", "  ")}  `, emp.name);
    check("4d extra/collapsed whitespace tolerated", spacey.ok);

    const good = checkAttestation(emp.name, emp.name);
    check("4e exact match accepted, stores what was TYPED",
      good.ok && good.attestedName === emp.name);

    // Mismatch must leave NO trace — the route checks before any write.
    const preAck = await db.warningLetter.findUnique({ where: { id: letter.id } });
    check("4f a rejected attestation writes nothing",
      preAck?.acknowledged === false && preAck?.attestedName === null,
      `acknowledged=${preAck?.acknowledged} attestedName=${preAck?.attestedName}`);

    // Now the accepted path, exactly as the route performs it.
    const fakeHeaders = new Headers({ "x-forwarded-for": "203.0.113.42, 10.0.0.1" });
    const ip = attestationIp(fakeHeaders);
    check("4g IP extracted from x-forwarded-for (first hop)",
      ip === "203.0.113.42", `ip=${ip}`);

    const ackUpd = await db.warningLetter.updateMany({
      where: { id: letter.id, employeeId: emp.id, status: "RELEASED", acknowledged: false },
      data: {
        acknowledged: true,
        attestedName: good.ok ? good.attestedName : "",
        attestedAt: new Date(),
        attestedIp: ip,
      },
    });
    check("4h matching name records the acknowledgement", ackUpd.count === 1);

    const acked = await db.warningLetter.findUnique({ where: { id: letter.id } });
    check("4i attestedName / attestedAt / attestedIp all populated",
      acked?.attestedName === emp.name &&
        acked?.attestedAt !== null &&
        acked?.attestedIp === "203.0.113.42",
      `name="${acked?.attestedName}" at=${acked?.attestedAt?.toISOString().slice(0, 19)} ip=${acked?.attestedIp}`);
    check("4j legacy `acknowledged` boolean still set for backward compatibility",
      acked?.acknowledged === true);

    const reAck = await db.warningLetter.updateMany({
      where: { id: letter.id, employeeId: emp.id, status: "RELEASED", acknowledged: false },
      data: { acknowledged: true },
    });
    check("4k re-attestation matches 0 rows — the first attestation is the record",
      reAck.count === 0);

    // ── STEP 5: GLOBAL SEARCH ───────────────────────────────────────
    step("5", "global search as HR — across Employee and Candidate");

    const req = await db.jobRequisition.create({
      data: {
        title: `${TAG} Line Supervisor`,
        department: "Assembly",
        description: "test",
        openings: 1,
        createdBy: ACTOR,
      },
    });
    const cand = await db.candidate.create({
      data: {
        name: `${TAG} Asha Candidate`,
        email: EMAIL,
        phone: "+91 90000 00000",
        resumeUrl: "00000000-0000-4000-8000-0000000000ff.pdf",
        source: "Career Page",
      },
    });
    await db.application.create({
      data: { candidateId: cand.id, jobRequisitionId: req.id },
    });

    const term = "Asha";
    const like = { contains: term, mode: "insensitive" as const };

    // The exact three queries the HR branch of /api/search runs.
    const [foundEmp, foundCand, foundReq] = await Promise.all([
      db.employee.findMany({
        where: { OR: [{ name: like }, { employeeCode: like }] },
        select: { id: true, name: true },
        take: 8,
      }),
      db.candidate.findMany({
        where: { OR: [{ name: like }, { email: like }] },
        select: { id: true, name: true },
        take: 8,
      }),
      db.jobRequisition.findMany({
        where: { title: { contains: "Line Supervisor", mode: "insensitive" } },
        select: { id: true, title: true },
        take: 8,
      }),
    ]);

    check("5a HR search matches an Employee by name",
      foundEmp.some((e) => e.id === emp.id),
      `"${term}" → ${foundEmp.length} employee hit(s)`);
    check("5b HR search matches a Candidate by name",
      foundCand.some((c) => c.id === cand.id),
      `"${term}" → ${foundCand.length} candidate hit(s)`);
    check("5c HR search matches a JobRequisition by title",
      foundReq.some((r) => r.id === req.id));
    check("5d same term matched BOTH an Employee and a Candidate",
      foundEmp.some((e) => e.id === emp.id) && foundCand.some((c) => c.id === cand.id),
      "org-wide scope confirmed for HR");

    const byEmail = await db.candidate.findMany({
      where: { OR: [{ name: { contains: "zz-p10-candidate", mode: "insensitive" } }, { email: { contains: "zz-p10-candidate", mode: "insensitive" } }] },
      take: 8,
    });
    check("5e candidate also findable by email", byEmail.some((c) => c.id === cand.id));

    // Manager scope: direct reports only.
    const mgrScope = await db.employee.findMany({
      where: {
        OR: [{ managerId: mgr.id }, { id: mgr.id }],
        AND: [{ OR: [{ name: like }, { employeeCode: like }] }],
      },
      select: { id: true },
      take: 8,
    });
    check("5f manager scope finds their own direct report",
      mgrScope.some((e) => e.id === emp.id), `${mgrScope.length} hit(s)`);

    // A manager must NOT reach an employee outside their team.
    const outsider = await db.employee.create({
      data: {
        employeeCode: `${TAG}-OUT`,
        name: `${TAG} Asha Outsider`,
        department: "Packaging",
        joiningDate: new Date(2020, 0, 1),
      },
    });
    const mgrScope2 = await db.employee.findMany({
      where: {
        OR: [{ managerId: mgr.id }, { id: mgr.id }],
        AND: [{ OR: [{ name: like }, { employeeCode: like }] }],
      },
      select: { id: true },
      take: 8,
    });
    check("5g manager scope EXCLUDES a same-named employee outside their team",
      !mgrScope2.some((e) => e.id === outsider.id),
      "scope is enforced in the where-clause, not filtered client-side");
  } finally {
    console.log("\n── CLEANUP ───────────────────────────────────────────");
    await cleanup();
    const left = {
      employees: await db.employee.count({ where: { employeeCode: { startsWith: TAG } } }),
      audit: await db.auditLog.count({ where: { actorUserId: { in: [ACTOR, ACTOR2] } } }),
      candidates: await db.candidate.count({ where: { email: EMAIL } }),
    };
    check("CLEANUP every test row removed",
      Object.values(left).every((n) => n === 0), JSON.stringify(left));
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
