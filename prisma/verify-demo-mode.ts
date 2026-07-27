/**
 * DEMO_MODE IMPERSONATION GATE VERIFICATION.
 *
 * Impersonation is a standing "act as anyone" capability. This proves it is
 * INERT — not merely hidden — unless DEMO_MODE is exactly "true".
 *
 * Both states are exercised against the REAL lib/impersonation.ts primitives.
 * That file has no "server-only" import and no Prisma (the edge middleware
 * imports it), so it runs here unmodified — these are the actual functions the
 * app calls, not reimplementations.
 *
 * Layer 3 re-runs the ORIGINAL impersonation assertions from when the feature
 * was built (sign/verify round-trip, Super-Admin binding, tamper detection) to
 * prove the gate changed nothing about how impersonation behaves when on.
 *
 * Cleans up: writes one AuditLog row to prove the audit path still works, then
 * deletes it. Touches nothing else.
 *
 * Run:  npx tsx prisma/verify-demo-mode.ts
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  IMP_COOKIE,
  demoModeEnabled,
  signImpersonation,
  verifyImpersonation,
  type ImpersonationPayload,
} from "../lib/impersonation.ts";

const db = new PrismaClient();
const ROOT = path.resolve(import.meta.dirname, "..");
const MARKER = "verify-demo-mode";

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

/** The signing key the real code uses. Any non-empty value works here. */
process.env.CLERK_SECRET_KEY ??= "sk_test_verify_demo_mode";

const REAL_SUPER_ADMIN = "user_realSuperAdmin123";
const PAYLOAD: ImpersonationPayload = {
  su: REAL_SUPER_ADMIN,
  cid: "test-employee-1-0003",
  role: "EMPLOYEE",
  eid: "emp_abc123",
  code: "EMP-0003",
  name: "Employee-1",
};

/** Set/clear DEMO_MODE the way a deployment would. */
function setDemoMode(v: string | undefined) {
  if (v === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = v;
}

async function main() {
  const originalDemoMode = process.env.DEMO_MODE;

  // ── 1: the switch itself ──────────────────────────────────────
  step("1", "DEMO_MODE parsing — only the exact string enables it");
  for (const v of [undefined, "", "false", "FALSE", "True", "TRUE", "1", "yes", "0", " true"]) {
    setDemoMode(v);
    check(
      `DEMO_MODE=${v === undefined ? "<unset>" : JSON.stringify(v)} → disabled`,
      demoModeEnabled() === false,
    );
  }
  setDemoMode("true");
  check('DEMO_MODE="true" → enabled', demoModeEnabled() === true);

  // ── 2: OFF — structurally inert ───────────────────────────────
  step("2", "DEMO_MODE off — impersonation is INERT");

  // A token minted while demo mode WAS on. This is the case that a
  // start-action-only gate would miss entirely.
  setDemoMode("true");
  const tokenFromDemo = await signImpersonation(PAYLOAD);
  check("a valid token exists (minted while demo mode was on)", tokenFromDemo.includes("."));

  setDemoMode(undefined);

  // (a) No new token can be minted.
  let signError: string | null = null;
  try {
    await signImpersonation(PAYLOAD);
  } catch (e) {
    signError = e instanceof Error ? e.message : String(e);
  }
  check("signImpersonation() THROWS with DEMO_MODE off", signError !== null, signError ?? "");
  check(
    "…and the error names DEMO_MODE",
    (signError ?? "").includes("DEMO_MODE"),
    signError ?? "",
  );

  // (b) The pre-existing, cryptographically VALID token is refused. This is
  //     the whole point: inert, not merely unstartable.
  const verifiedOff = await verifyImpersonation(tokenFromDemo, REAL_SUPER_ADMIN);
  eq("a VALID pre-existing token verifies to null with DEMO_MODE off", verifiedOff, null);

  // (c) Same token, same real user, demo mode back on → verifies. Proves (b)
  //     was the gate refusing, not a broken signature.
  setDemoMode("true");
  const verifiedOn = await verifyImpersonation(tokenFromDemo, REAL_SUPER_ADMIN);
  check("the SAME token verifies once DEMO_MODE is on again", verifiedOn !== null);
  eq("→ so (b) was the gate, not an invalid signature", verifiedOn?.cid, PAYLOAD.cid);
  setDemoMode(undefined);

  // (d) The server action rejects before any identity work. Static, because a
  //     "use server" action cannot be invoked outside the Next runtime — so
  //     assert the ORDER of the guard in the real source.
  const actionsSrc = fs.readFileSync(
    path.join(ROOT, "app/admin/impersonate/actions.ts"),
    "utf8",
  );
  const iDemo = actionsSrc.indexOf("if (!demoModeEnabled())");
  const iIdentity = actionsSrc.indexOf("await getRealIdentity()");
  const iRole = actionsSrc.indexOf('realRole !== "SUPER_ADMIN"');
  const iDb = actionsSrc.indexOf("db.user.findFirst");
  check("startImpersonation() has a DEMO_MODE guard", iDemo > 0);
  check("…it is BEFORE identity resolution", iDemo < iIdentity);
  check("…BEFORE the Super Admin role check", iDemo < iRole);
  check("…and BEFORE any database access", iDemo < iDb);
  check(
    "…so a genuine SUPER_ADMIN is rejected too (guard has no role condition)",
    /if \(!demoModeEnabled\(\)\) \{\s*throw new Error\(/.test(actionsSrc),
  );

  // (e) Even if the action's guard were removed, signImpersonation() still
  //     refuses — the action cannot complete. Proven by (a).
  check("defence in depth: the action cannot mint a token even if its guard were bypassed", signError !== null);

  // (f) The panel does not render.
  const panelSrc = fs.readFileSync(
    path.join(ROOT, "components/admin/impersonate-panel.tsx"),
    "utf8",
  );
  const pDemo = panelSrc.indexOf("if (!demoModeEnabled()) return null;");
  const pQuery = panelSrc.indexOf("db.user.findMany");
  check("ImpersonatePanel returns null when DEMO_MODE is off", pDemo > 0);
  check("…before it queries users (no wasted work)", pDemo < pQuery);
  check(
    "…returning null renders NO markup (not a disabled panel)",
    /if \(!demoModeEnabled\(\)\) return null;/.test(panelSrc),
  );

  // ── 3: effective identity collapses to real identity ──────────
  step("3", "DEMO_MODE off — effective identity === real identity");

  // resolveIdentity() imports server-only, so it cannot run here. Its
  // impersonation branch is entirely gated on verifyImpersonation() returning
  // non-null — which section 2(b) proved is impossible with DEMO_MODE off. So
  // the branch is unreachable and the function falls through to the real
  // identity. Assert that structure against the real source.
  const authSrc = fs.readFileSync(path.join(ROOT, "lib/auth.ts"), "utf8");
  check(
    "resolveIdentity() only impersonates when verifyImpersonation() returns non-null",
    /const imp = await verifyImpersonation\([\s\S]{0,80}?\);\s*if \(imp\) \{/.test(authSrc),
  );
  check(
    "…and otherwise returns userId = realUserId, role = realRole",
    /return \{ realUserId, realRole, userId: realUserId, role: realRole, impersonation: null \};/.test(
      authSrc,
    ),
  );

  // Simulate resolveIdentity()'s exact branch with the real verifier.
  setDemoMode(undefined);
  for (const realRole of ["SUPER_ADMIN", "HR", "MANAGER", "EMPLOYEE"] as const) {
    const imp =
      realRole === "SUPER_ADMIN"
        ? await verifyImpersonation(tokenFromDemo, REAL_SUPER_ADMIN)
        : null;
    const identity = imp
      ? { userId: imp.cid, role: imp.role, impersonation: imp }
      : { userId: REAL_SUPER_ADMIN, role: realRole, impersonation: null };
    eq(`${realRole}: effective userId === real userId`, identity.userId, REAL_SUPER_ADMIN);
    eq(`${realRole}: effective role === real role`, identity.role, realRole);
    eq(`${realRole}: impersonation payload is null`, identity.impersonation, null);
  }

  // The edge middleware resolves through the same function.
  const mwSrc = fs.readFileSync(path.join(ROOT, "middleware.ts"), "utf8");
  check(
    "middleware.ts resolves impersonation through the same verifyImpersonation()",
    mwSrc.includes("verifyImpersonation(req.cookies.get(IMP_COOKIE)?.value, userId)"),
  );
  check(
    "…so there is no second code path that could honour a cookie",
    (fs.readFileSync(path.join(ROOT, "lib/auth.ts"), "utf8") + mwSrc).match(/verifyImpersonation\(/g)
      ?.length === 2,
  );

  // ── 4: ON — the original behaviour, unchanged ─────────────────
  // These are the assertions from when impersonation was first built.
  step("4", "DEMO_MODE=true — original behaviour intact");
  setDemoMode("true");

  const token = await signImpersonation(PAYLOAD);
  const round = await verifyImpersonation(token, REAL_SUPER_ADMIN);
  check("sign → verify round-trip succeeds", round !== null);
  eq("payload.su survives", round?.su, PAYLOAD.su);
  eq("payload.cid survives", round?.cid, PAYLOAD.cid);
  eq("payload.role survives", round?.role, PAYLOAD.role);
  eq("payload.eid survives", round?.eid, PAYLOAD.eid);
  eq("payload.code survives", round?.code, PAYLOAD.code);
  eq("payload.name survives", round?.name, PAYLOAD.name);

  // BINDING: a copied cookie used under a different Super Admin fails.
  eq(
    "a token bound to another Super Admin is REJECTED",
    await verifyImpersonation(token, "user_someoneElse"),
    null,
  );

  // TAMPERING: any edit to body or signature invalidates it.
  const dot = token.lastIndexOf(".");
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  eq(
    "a tampered SIGNATURE is rejected",
    await verifyImpersonation(`${body}.${sig.slice(0, -1)}0`, REAL_SUPER_ADMIN),
    null,
  );
  const forged = Buffer.from(
    JSON.stringify({ ...PAYLOAD, role: "SUPER_ADMIN" }),
    "utf8",
  )
    .toString("base64url");
  eq(
    "a forged BODY (escalating role) is rejected",
    await verifyImpersonation(`${forged}.${sig}`, REAL_SUPER_ADMIN),
    null,
  );
  eq("an absent token is rejected", await verifyImpersonation(undefined, REAL_SUPER_ADMIN), null);
  eq("a malformed token is rejected", await verifyImpersonation("garbage", REAL_SUPER_ADMIN), null);

  eq("the cookie name is unchanged", IMP_COOKIE, "sess_impersonation");

  // The audit path still writes. One row, then removed.
  const row = await db.auditLog.create({
    data: {
      actorUserId: MARKER,
      action: "IMPERSONATION_STARTED",
      targetEntity: `${MARKER}-target`,
    },
  });
  const found = await db.auditLog.findUnique({ where: { id: row.id } });
  check("an IMPERSONATION_STARTED audit row can still be written", found !== null);

  // ── 5: cleanup ────────────────────────────────────────────────
  step("5", "cleanup");
  await db.auditLog.deleteMany({ where: { actorUserId: MARKER } });
  eq("test audit rows removed", await db.auditLog.count({ where: { actorUserId: MARKER } }), 0);
  setDemoMode(originalDemoMode);
  eq(
    "DEMO_MODE restored to how this process found it",
    process.env.DEMO_MODE,
    originalDemoMode,
  );
}

main()
  .then(async () => {
    console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
    if (fail > 0) process.exitCode = 1;
    await db.$disconnect();
  })
  .catch(async (err) => {
    console.error("VERIFY CRASHED:", err);
    await db.auditLog.deleteMany({ where: { actorUserId: MARKER } }).catch(() => {});
    await db.$disconnect();
    process.exitCode = 1;
  });
