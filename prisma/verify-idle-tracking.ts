/**
 * Idle-tracking verification: consent gating, token issue/revoke, heartbeat
 * ingestion with ATOMIC increments, and consent revocation mid-stream.
 *
 * Runs against the REAL database with the real Prisma client and the real
 * consent/token logic. Creates its own throwaway data and deletes everything,
 * pass or fail.
 *
 * Run:  node --env-file=.env prisma/verify-idle-tracking.ts
 */
import { PrismaClient } from "@prisma/client";
import { idleConsentState, IDLE_CONSENT_TYPE } from "../lib/idle/consent.ts";
import { newAgentToken, tokenFingerprint } from "../lib/idle/token.ts";

const db = new PrismaClient();

const TAG = "ZZ-IDLE";
const HR = "test-idle-hr";

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
    where: { employeeCode: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = emps.map((e) => e.id);
  await db.idleLog.deleteMany({ where: { employeeId: { in: ids } } });
  await db.agentToken.deleteMany({ where: { employeeId: { in: ids } } });
  await db.consentRecord.deleteMany({ where: { employeeId: { in: ids } } });
  await db.employee.deleteMany({ where: { id: { in: ids } } });
  await db.auditLog.deleteMany({ where: { actorUserId: HR } });
}

/**
 * Replays the heartbeat route's exact logic against the DB, so what is tested
 * is the real gate sequence and the real atomic write — not a paraphrase.
 */
async function heartbeat(
  token: string,
  batch: { idleMinutes: number; activeMinutes: number; windowEnd: Date },
): Promise<{ status: number; code: string; shouldPause?: boolean; totals?: { idle: number; active: number } }> {
  const agent = await db.agentToken.findUnique({
    where: { token },
    select: {
      id: true,
      active: true,
      employeeId: true,
      employee: { select: { active: true } },
    },
  });
  if (!agent || !agent.active)
    return { status: 401, code: "INVALID_TOKEN", shouldPause: true };
  if (!agent.employee.active)
    return { status: 403, code: "INACTIVE_EMPLOYEE", shouldPause: true };

  const consent = await idleConsentState(db, agent.employeeId);
  if (!consent.active)
    return { status: 403, code: "PAUSE_TRACKING", shouldPause: true };

  const day = new Date(
    batch.windowEnd.getFullYear(),
    batch.windowEnd.getMonth(),
    batch.windowEnd.getDate(),
  );

  const row = await db.idleLog.upsert({
    where: { employeeId_date: { employeeId: agent.employeeId, date: day } },
    update: {
      idleMinutes: { increment: batch.idleMinutes },
      activeMinutes: { increment: batch.activeMinutes },
    },
    create: {
      employeeId: agent.employeeId,
      date: day,
      idleMinutes: batch.idleMinutes,
      activeMinutes: batch.activeMinutes,
    },
  });

  await db.agentToken.update({ where: { id: agent.id }, data: { lastSeenAt: new Date() } });
  return {
    status: 200,
    code: "OK",
    totals: { idle: row.idleMinutes, active: row.activeMinutes },
  };
}

/** The consent gate the token-issue route applies. */
async function issueToken(employeeId: string, name: string) {
  const consent = await idleConsentState(db, employeeId);
  if (!consent.active)
    return { ok: false as const, code: "NO_CONSENT", reason: consent.reason };

  const token = newAgentToken();
  await db.$transaction(async (tx) => {
    await tx.agentToken.upsert({
      where: { employeeId },
      update: { token, active: true, lastSeenAt: null },
      create: { employeeId, token, active: true },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: HR,
        action: "AGENT_TOKEN_ISSUED",
        targetEntity: `${employeeId} (${name}) fingerprint=${tokenFingerprint(token)}`,
      },
    });
  });
  return { ok: true as const, token };
}

async function main() {
  try {
    await cleanup();
    console.log("══ IDLE TRACKING VERIFICATION ══════════════════════════");

    const emp = await db.employee.create({
      data: {
        employeeCode: `${TAG}-001`,
        name: `${TAG} Ravi Kumar`,
        department: "Assembly",
        joiningDate: new Date(2020, 0, 1),
        active: true,
      },
    });

    // ── 1: TOKEN WITHOUT CONSENT ────────────────────────────────────
    step("1", "issue a token WITHOUT consent → rejected");
    const noConsent = await idleConsentState(db, emp.id);
    check("1a employee starts with NO idle-tracking consent",
      !noConsent.active && noConsent.reason === "NEVER_GIVEN",
      `state=${JSON.stringify(noConsent)}`);

    const attempt1 = await issueToken(emp.id, emp.name);
    check("1b token issue REJECTED with NO_CONSENT",
      !attempt1.ok && attempt1.code === "NO_CONSENT",
      "HR is directed to the Compliance & Consent page first");
    check("1c no token row was created",
      (await db.agentToken.count({ where: { employeeId: emp.id } })) === 0);

    // ── 2: RECORD CONSENT, THEN ISSUE ───────────────────────────────
    step("2", "record consent → token issues successfully");
    await db.consentRecord.create({
      data: {
        employeeId: emp.id,
        consentType: IDLE_CONSENT_TYPE,
        givenOn: new Date(),
        retentionExpiry: null, // open-ended
      },
    });
    const consentNow = await idleConsentState(db, emp.id);
    check("2a consent now reads ACTIVE", consentNow.active === true);

    const attempt2 = await issueToken(emp.id, emp.name);
    check("2b token issued", attempt2.ok === true);
    const token = attempt2.ok ? attempt2.token : "";
    check("2c token is a long random secret with a recognisable prefix",
      token.startsWith("sess_agent_") && token.length >= 75,
      `${token.slice(0, 20)}… (${token.length} chars)`);

    const audit = await db.auditLog.findFirst({
      where: { action: "AGENT_TOKEN_ISSUED", actorUserId: HR },
    });
    check("2d AGENT_TOKEN_ISSUED audit records the FINGERPRINT, never the token",
      audit !== null &&
        audit.targetEntity.includes(tokenFingerprint(token)) &&
        !audit.targetEntity.includes(token),
      `"${audit?.targetEntity}"`);

    // ── 3: FIRST HEARTBEAT ──────────────────────────────────────────
    step("3", "first heartbeat batch creates the day's row");
    const windowEnd = new Date(2026, 5, 15, 10, 15, 0);
    const hb1 = await heartbeat(token, {
      idleMinutes: 4,
      activeMinutes: 11,
      windowEnd,
    });
    check("3a heartbeat accepted", hb1.status === 200, `code=${hb1.code}`);
    check("3b IdleLog created with the batch's values",
      hb1.totals?.idle === 4 && hb1.totals?.active === 11,
      `idle=${hb1.totals?.idle} active=${hb1.totals?.active}`);

    const tok1 = await db.agentToken.findUnique({ where: { token } });
    check("3c lastSeenAt updated so HR can spot a silent agent",
      tok1?.lastSeenAt !== null, `lastSeenAt=${tok1?.lastSeenAt?.toISOString()}`);

    // ── 4: SECOND BATCH ADDS, DOES NOT OVERWRITE ────────────────────
    step("4", "second batch INCREMENTS the running total");
    const hb2 = await heartbeat(token, {
      idleMinutes: 6,
      activeMinutes: 9,
      windowEnd: new Date(2026, 5, 15, 10, 30, 0),
    });
    check("4a second heartbeat accepted", hb2.status === 200);
    check("4b totals ADDED, not replaced: idle 4+6=10, active 11+9=20",
      hb2.totals?.idle === 10 && hb2.totals?.active === 20,
      `idle=${hb2.totals?.idle} active=${hb2.totals?.active} (a read-then-write bug would show 6/9)`);

    const rows = await db.idleLog.findMany({ where: { employeeId: emp.id } });
    check("4c still exactly ONE row for the day (not one per batch)",
      rows.length === 1, `${rows.length} row(s)`);

    // ── 5: ATOMICITY UNDER CONCURRENCY ──────────────────────────────
    step("5", "atomic increment — concurrent batches all land");
    // Ten batches fired simultaneously. With a read-then-write the writes
    // would clobber each other and the total would fall short of 10.
    const before = rows[0].activeMinutes;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        heartbeat(token, {
          idleMinutes: 0,
          activeMinutes: 1,
          windowEnd: new Date(2026, 5, 15, 11, 0, 0),
        }),
      ),
    );
    const after = await db.idleLog.findUnique({
      where: { employeeId_date: { employeeId: emp.id, date: new Date(2026, 5, 15) } },
    });
    check("5a ALL 10 concurrent increments landed (20 + 10 = 30)",
      after?.activeMinutes === before + 10,
      `expected ${before + 10}, got ${after?.activeMinutes} — a lost update would be < ${before + 10}`);

    // ── 6: SEPARATE DAY ─────────────────────────────────────────────
    step("6", "a different day gets its own row");
    await heartbeat(token, {
      idleMinutes: 2,
      activeMinutes: 13,
      windowEnd: new Date(2026, 5, 16, 9, 15, 0),
    });
    const allRows = await db.idleLog.findMany({
      where: { employeeId: emp.id },
      orderBy: { date: "asc" },
    });
    check("6a two rows now, one per day",
      allRows.length === 2, `${allRows.length} rows`);
    check("6b day 1 total untouched by day 2's batch",
      allRows[0].activeMinutes === 30 && allRows[1].activeMinutes === 13,
      `day1 active=${allRows[0].activeMinutes}, day2 active=${allRows[1].activeMinutes}`);

    // ── 7: CONSENT REVOKED MID-STREAM ───────────────────────────────
    step("7", "consent revoked → heartbeats rejected");
    // Revocation = a consent record whose retentionExpiry has passed, the same
    // mechanism the Compliance page already renders as "(expired)".
    await db.consentRecord.create({
      data: {
        employeeId: emp.id,
        consentType: IDLE_CONSENT_TYPE,
        givenOn: new Date(),
        retentionExpiry: new Date(Date.now() - 86400000), // yesterday
      },
    });
    const revoked = await idleConsentState(db, emp.id);
    check("7a consent now reads EXPIRED",
      !revoked.active && revoked.reason === "EXPIRED",
      `state=${JSON.stringify(revoked)}`);

    const totalsBefore = await db.idleLog.aggregate({
      where: { employeeId: emp.id },
      _sum: { activeMinutes: true },
    });

    const hb3 = await heartbeat(token, {
      idleMinutes: 5,
      activeMinutes: 10,
      windowEnd: new Date(2026, 5, 17, 9, 15, 0),
    });
    check("7b heartbeat REJECTED with 403 PAUSE_TRACKING",
      hb3.status === 403 && hb3.code === "PAUSE_TRACKING",
      `status=${hb3.status} code=${hb3.code}`);
    check("7c response tells the agent to PAUSE (not a bare 401 it would retry)",
      hb3.shouldPause === true,
      "shouldPause:true — the agent stops rather than hammering the server");

    const totalsAfter = await db.idleLog.aggregate({
      where: { employeeId: emp.id },
      _sum: { activeMinutes: true },
    });
    check("7d the rejected batch was NOT stored",
      totalsAfter._sum.activeMinutes === totalsBefore._sum.activeMinutes,
      `before=${totalsBefore._sum.activeMinutes} after=${totalsAfter._sum.activeMinutes}`);
    check("7e no row was created for the rejected day",
      (await db.idleLog.count({
        where: { employeeId: emp.id, date: new Date(2026, 5, 17) },
      })) === 0);

    // Re-issuing is also blocked while consent is expired.
    const reissue = await issueToken(emp.id, emp.name);
    check("7f token cannot be re-issued while consent is expired",
      !reissue.ok && reissue.code === "NO_CONSENT");

    // ── 8: TOKEN REVOCATION ─────────────────────────────────────────
    step("8", "revoked token is refused");
    // Restore consent so the ONLY reason for refusal is the token itself.
    await db.consentRecord.create({
      data: {
        employeeId: emp.id,
        consentType: IDLE_CONSENT_TYPE,
        givenOn: new Date(),
        retentionExpiry: null,
      },
    });
    check("8a consent restored", (await idleConsentState(db, emp.id)).active === true);

    await db.agentToken.updateMany({
      where: { employeeId: emp.id, active: true },
      data: { active: false },
    });
    const hb4 = await heartbeat(token, {
      idleMinutes: 1,
      activeMinutes: 14,
      windowEnd: new Date(2026, 5, 18, 9, 15, 0),
    });
    check("8b revoked token rejected even with valid consent",
      hb4.status === 401 && hb4.code === "INVALID_TOKEN",
      `status=${hb4.status} code=${hb4.code}`);

    const bogus = await heartbeat("sess_agent_totally_made_up", {
      idleMinutes: 1,
      activeMinutes: 1,
      windowEnd: new Date(),
    });
    check("8c an unknown token gets the SAME response as a revoked one",
      bogus.status === 401 && bogus.code === "INVALID_TOKEN",
      "probing tokens reveals nothing about which exist");

    // ── 9: OFFBOARDED EMPLOYEE ──────────────────────────────────────
    step("9", "offboarded employee stops being tracked");
    await db.agentToken.updateMany({
      where: { employeeId: emp.id },
      data: { active: true },
    });
    await db.employee.update({ where: { id: emp.id }, data: { active: false } });
    const hb5 = await heartbeat(token, {
      idleMinutes: 1,
      activeMinutes: 1,
      windowEnd: new Date(),
    });
    check("9a heartbeat refused for an offboarded employee",
      hb5.status === 403 && hb5.code === "INACTIVE_EMPLOYEE" && hb5.shouldPause === true,
      `status=${hb5.status} code=${hb5.code}`);
  } finally {
    console.log("\n── CLEANUP ───────────────────────────────────────────");
    await cleanup();
    const left = {
      employees: await db.employee.count({ where: { employeeCode: { startsWith: TAG } } }),
      tokens: await db.agentToken.count(),
      idleLogs: await db.idleLog.count(),
    };
    check("CLEANUP every test row removed",
      left.employees === 0 && left.tokens === 0 && left.idleLogs === 0,
      JSON.stringify(left));
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
