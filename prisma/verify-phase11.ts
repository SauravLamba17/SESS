/**
 * Phase 11 verification: role change (DB + Clerk sync path), the idle-tracking
 * kill switch, and the organization aggregation.
 *
 * Runs against the REAL database with the REAL logic (lib/admin/user-role.ts,
 * lib/admin/organization.ts, and the live /api/agent/heartbeat route over
 * HTTP). The ONLY stub is the Clerk metadata call — same injectable pattern as
 * the invitation phase, so everything except the external HTTP call to Clerk
 * is exercised for real.
 *
 * The kill-switch section requires the dev server on localhost:3005 (it POSTs
 * real heartbeats). Creates its own throwaway data, restores the toggle, and
 * deletes everything, pass or fail.
 *
 * Run (with `npm run dev` up):  node --env-file=.env prisma/verify-phase11.ts
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
const BASE = "http://localhost:3005";

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

async function heartbeat(): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/api/agent/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ idleMinutes: 1, activeMinutes: 2, windowEnd: new Date().toISOString() }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
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

  // ── 2: idle-tracking kill switch over the REAL heartbeat route ──
  step("2", "kill switch — real heartbeats against the dev server");
  await db.consentRecord.create({
    data: { employeeId: emp.id, consentType: "IDLE_TRACKING", givenOn: new Date() },
  });
  await db.agentToken.create({ data: { employeeId: emp.id, token: TOKEN } });

  let serverUp = true;
  try {
    // Toggle ON explicitly first, so the test is deterministic.
    await db.systemSetting.upsert({
      where: { key: KILL_KEY },
      update: { value: "true", updatedBy: ACTOR },
      create: { key: KILL_KEY, value: "true", updatedBy: ACTOR },
    });
    const on = await heartbeat();
    check("heartbeat ACCEPTED while enabled (consent valid)", on.status === 200, JSON.stringify(on));

    await db.systemSetting.update({ where: { key: KILL_KEY }, data: { value: "false" } });
    const off = await heartbeat();
    check(
      "heartbeat REJECTED when disabled — despite valid token AND consent",
      off.status === 403 && off.body.code === "IDLE_TRACKING_DISABLED",
      JSON.stringify(off),
    );
    check("rejection tells the agent to pause", off.body.shouldPause === true);

    await db.systemSetting.update({ where: { key: KILL_KEY }, data: { value: "true" } });
    const backOn = await heartbeat();
    check("heartbeat accepted again after re-enable", backOn.status === 200, JSON.stringify(backOn));
  } catch (e) {
    serverUp = false;
    check(
      "kill-switch HTTP test ran (is `npm run dev` up on :3005?)",
      false,
      e instanceof Error ? e.message : String(e),
    );
  }
  if (serverUp) {
    const logged = await db.idleLog.findFirst({ where: { employeeId: emp.id } });
    check(
      "only the ACCEPTED beats were stored (1+2 twice, nothing from the rejected one)",
      logged?.idleMinutes === 2 && logged?.activeMinutes === 4,
      JSON.stringify(logged),
    );
  }

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

  // ── restore the kill switch to its pre-test state ──────────────
  if (priorKill) {
    await db.systemSetting.upsert({
      where: { key: KILL_KEY },
      update: { value: priorKill.value, updatedBy: priorKill.updatedBy },
      create: { key: KILL_KEY, value: priorKill.value, updatedBy: priorKill.updatedBy },
    });
  } else {
    await db.systemSetting.deleteMany({ where: { key: KILL_KEY } });
  }
  console.log("\nkill switch restored to pre-test state");

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
