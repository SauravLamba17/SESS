/**
 * Phase 11 verification: role change (DB + Clerk sync path), the idle-tracking
 * kill switch, and the organization aggregation.
 *
 * Runs against the REAL database with the REAL logic (lib/admin/user-role.ts,
 * lib/admin/organization.ts, and the real /api/agent/heartbeat POST handler).
 * The ONLY stub is the Clerk metadata call — same injectable pattern as the
 * invitation phase.
 *
 * ─── THE KILL SWITCH IS NEVER WRITTEN TO THE LIVE ROW ─────────────────────
 * IDLE_TRACKING_ENABLED is one org-wide row. The previous version flipped it
 * for real and called the dev server over HTTP, so any installed agent that
 * beat during that window got shouldPause and latched itself stopped. Now the
 * heartbeat handler is imported IN-PROCESS with globalThis.prisma set to an
 * interactive-transaction client (lib/db.ts reuses globalThis.prisma), so the
 * toggle, the fixtures and every write the route makes happen inside ONE
 * transaction that is always rolled back. Postgres MVCC means every other
 * connection keeps reading the committed value throughout; the only
 * observable effect is that a Super Admin saving that toggle in the same
 * few seconds would wait for the rollback. Section 2 ends by asserting the
 * live row is byte-identical to before.
 *
 * Creates its own throwaway data (sections 1, 3) and deletes it, pass or fail.
 * No dev server needed.
 *
 * Run:  node --env-file=.env --import ./scripts/alias-loader.mjs prisma/verify-phase11.ts
 */
import { PrismaClient } from "@prisma/client";
import { changeUserRole, type UpdateClerkRoleFn } from "../lib/admin/user-role.ts";
import { departmentSummary } from "../lib/admin/organization.ts";

const db = new PrismaClient();

const TAG = "ZZ-P11";
const ACTOR = "test-p11-actor";
const CLERK_ID = "user_zzp11test_0001";
const TOKEN = "sess_agent_zzp11_test_token_000000000001";
const KILL_KEY = "IDLE_TRACKING_ENABLED";

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
  await db.user.deleteMany({ where: { OR: [{ clerkId: CLERK_ID }, { employeeId: { in: ids } }] } });
  await db.idleLog.deleteMany({ where: { employeeId: { in: ids } } });
  await db.agentToken.deleteMany({ where: { OR: [{ token: TOKEN }, { employeeId: { in: ids } }] } });
  await db.consentRecord.deleteMany({ where: { employeeId: { in: ids } } });
  await db.employee.deleteMany({ where: { id: { in: ids } } });
  await db.auditLog.deleteMany({
    where: { OR: [{ actorUserId: ACTOR }, ...ids.map((id) => ({ targetEntity: { contains: id } }))] },
  });
}

async function main() {
  await cleanup();

  // Preserve whatever the kill switch is set to right now.
  const priorKill = await db.systemSetting.findUnique({ where: { key: KILL_KEY } });

  // ── 1: role change — DB first, Clerk stubbed ───────────────────
  step("1", "changeUserRole — success path (stubbed Clerk)");
  const emp = await db.employee.create({
    data: {
      employeeCode: `${TAG}-0001`,
      name: `${TAG} Role Target`,
      department: `${TAG}-Ops`,
      joiningDate: new Date(2026, 0, 1),
    },
  });
  const user = await db.user.create({
    data: { clerkId: CLERK_ID, role: "EMPLOYEE", employeeId: emp.id },
  });

  const clerkCalls: { clerkId: string; role: string }[] = [];
  const stubOk: UpdateClerkRoleFn = async (clerkId, role) => {
    clerkCalls.push({ clerkId, role });
  };

  const r1 = await changeUserRole(
    db,
    { userId: user.id, newRole: "MANAGER", actorUserId: ACTOR },
    stubOk,
  );
  check("returned ok + synced", r1.ok && r1.clerkSynced === true, JSON.stringify(r1));
  check(
    "old→new roles reported",
    r1.ok && r1.oldRole === "EMPLOYEE" && r1.newRole === "MANAGER",
  );
  const dbUser1 = await db.user.findUnique({ where: { id: user.id } });
  check("DB role updated", dbUser1?.role === "MANAGER");
  check(
    "Clerk called with clerkId + new role (DB was first)",
    clerkCalls.length === 1 && clerkCalls[0].clerkId === CLERK_ID && clerkCalls[0].role === "MANAGER",
    JSON.stringify(clerkCalls),
  );
  const audit1 = await db.auditLog.findFirst({
    where: { action: "USER_ROLE_CHANGED", targetEntity: { contains: user.id } },
  });
  check(
    "USER_ROLE_CHANGED audit row includes old and new role",
    audit1 !== null && audit1.targetEntity.includes("EMPLOYEE→MANAGER"),
    audit1?.targetEntity ?? "no row",
  );

  step("1b", "changeUserRole — Clerk failure surfaces, never silent");
  const stubFail: UpdateClerkRoleFn = async () => {
    throw new Error("clerk unreachable (simulated)");
  };
  const r2 = await changeUserRole(
    db,
    { userId: user.id, newRole: "HR", actorUserId: ACTOR },
    stubFail,
  );
  check(
    "ok but clerkSynced=false with the error message",
    r2.ok && r2.clerkSynced === false && (r2.clerkError ?? "").includes("simulated"),
    JSON.stringify(r2),
  );
  const dbUser2 = await db.user.findUnique({ where: { id: user.id } });
  check("DB role still updated despite Clerk failure", dbUser2?.role === "HR");
  const syncFailAudit = await db.auditLog.findFirst({
    where: { action: "USER_ROLE_CLERK_SYNC_FAILED", targetEntity: { contains: user.id } },
  });
  check("USER_ROLE_CLERK_SYNC_FAILED audit row", syncFailAudit !== null);

  step("1c", "retry path — same role re-syncs Clerk");
  clerkCalls.length = 0;
  const r3 = await changeUserRole(
    db,
    { userId: user.id, newRole: "HR", actorUserId: ACTOR },
    stubOk,
  );
  check(
    "same-role call retried the Clerk sync successfully",
    r3.ok && r3.clerkSynced === true && clerkCalls.length === 1,
    JSON.stringify({ r3, clerkCalls }),
  );

  // ── 2: idle-tracking kill switch — real handler, rolled-back transaction ──
  step("2", "kill switch — real heartbeat handler inside a rolled-back txn");
  class Rollback extends Error {}
  try {
    await db.$transaction(
      async (tx) => {
        // Must be set BEFORE the route (and so lib/db.ts) is first imported.
        (globalThis as unknown as { prisma: unknown }).prisma = tx;
        const { POST } = await import("../app/api/agent/heartbeat/route.ts");
        const { NextRequest } = await import("next/server");
        const beat = async () => {
          const res = await POST(
            new NextRequest("http://localhost/api/agent/heartbeat", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
              body: JSON.stringify({ idleMinutes: 1, activeMinutes: 2, windowEnd: new Date().toISOString() }),
            }),
          );
          return { status: res.status, body: (await res.json()) as Record<string, unknown> };
        };

        await tx.consentRecord.create({
          data: { employeeId: emp.id, consentType: "IDLE_TRACKING", givenOn: new Date() },
        });
        await tx.agentToken.create({ data: { employeeId: emp.id, token: TOKEN } });

        await tx.systemSetting.upsert({
          where: { key: KILL_KEY },
          update: { value: "true", updatedBy: ACTOR },
          create: { key: KILL_KEY, value: "true", updatedBy: ACTOR },
        });
        const on = await beat();
        check("heartbeat ACCEPTED while enabled (consent valid)", on.status === 200, JSON.stringify(on));

        await tx.systemSetting.update({ where: { key: KILL_KEY }, data: { value: "false" } });
        const off = await beat();
        check(
          "heartbeat REJECTED when disabled — despite valid token AND consent",
          off.status === 403 && off.body.code === "IDLE_TRACKING_DISABLED",
          JSON.stringify(off),
        );
        check("rejection tells the agent to pause", off.body.shouldPause === true);

        await tx.systemSetting.update({ where: { key: KILL_KEY }, data: { value: "true" } });
        const backOn = await beat();
        check("heartbeat accepted again after re-enable", backOn.status === 200, JSON.stringify(backOn));

        const logged = await tx.idleLog.findFirst({ where: { employeeId: emp.id } });
        check(
          "only the ACCEPTED beats were stored (1+2 twice, nothing from the rejected one)",
          logged?.idleMinutes === 2 && logged?.activeMinutes === 4,
          JSON.stringify(logged),
        );
        throw new Rollback();
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  } catch (e) {
    if (!(e instanceof Rollback))
      check("kill-switch section ran", false, e instanceof Error ? e.message : String(e));
  }
  const afterKill = await db.systemSetting.findUnique({ where: { key: KILL_KEY } });
  check(
    "LIVE kill-switch row untouched (identical to before the suite)",
    JSON.stringify(afterKill) === JSON.stringify(priorKill),
    `before=${JSON.stringify(priorKill)} after=${JSON.stringify(afterKill)}`,
  );

  // ── 3: organization aggregation ────────────────────────────────
  step("3", "departmentSummary — known test data");
  const mgr = await db.employee.create({
    data: {
      employeeCode: `${TAG}-0002`,
      name: `${TAG} Manager`,
      department: `${TAG}-Ops`,
      joiningDate: new Date(2026, 0, 1),
    },
  });
  await db.employee.createMany({
    data: [
      { employeeCode: `${TAG}-0003`, name: `${TAG} Worker A`, department: `${TAG}-Ops`, managerId: mgr.id, joiningDate: new Date(2026, 0, 1) },
      { employeeCode: `${TAG}-0004`, name: `${TAG} Worker B`, department: `${TAG}-QA`, managerId: mgr.id, joiningDate: new Date(2026, 0, 1) },
    ],
  });
  // Same query shape as app/admin/organization/page.tsx, filtered to test rows.
  const testEmps = await db.employee.findMany({
    where: { active: true, department: { startsWith: TAG } },
    select: { id: true, department: true, managerId: true, manager: { select: { name: true } } },
  });
  const summary = departmentSummary(
    testEmps.map((e) => ({
      id: e.id,
      department: e.department,
      managerId: e.managerId,
      managerName: e.manager?.name ?? null,
    })),
  );
  const ops = summary.find((d) => d.department === `${TAG}-Ops`);
  const qa = summary.find((d) => d.department === `${TAG}-QA`);
  check(
    "Ops: headcount 3 (target + manager + worker A), managed by the manager",
    ops?.headcount === 3 && ops.managers.length === 1 && ops.managers[0] === `${TAG} Manager`,
    JSON.stringify(ops),
  );
  check("QA: headcount 1, overseen by the (cross-department) manager", qa?.headcount === 1 && qa.managers[0] === `${TAG} Manager`, JSON.stringify(qa));
  check("sorted by headcount desc", summary[0]?.department === `${TAG}-Ops`);

  console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("VERIFY SCRIPT CRASHED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await db.$disconnect();
    console.log("cleanup complete");
  });
