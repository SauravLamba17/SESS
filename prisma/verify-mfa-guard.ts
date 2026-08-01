/**
 * MFA API-GATE VERIFICATION.
 *
 * Three layers, because the interesting claims are of three different kinds:
 *
 *  1. THE DECISION — mfaGateOutcome() over every role × MFA-state combination,
 *     using the REAL pure function the wrapper calls. Includes the two
 *     "previously unwrapped route" cases the brief asks for, driven through a
 *     stub of the wrapper so an actual handler is either reached or not.
 *
 *  2. COVERAGE — static analysis of every route file under app/api/hr/** and
 *     app/api/admin/**, asserting each exported HTTP method is wrapped. This is
 *     what proves no route was silently skipped, now or in a later edit.
 *
 *  3. NON-INTERFERENCE over real HTTP — an unauthenticated call to a wrapped
 *     route must still get the handler's own 401, never the gate's 403. That is
 *     the guarantee that the wrapper did not change any existing status code.
 *
 * Run (dev server up for layer 3):  node --env-file=.env prisma/verify-mfa-guard.ts
 */
import fs from "node:fs";
import path from "node:path";
import {
  mfaGateOutcome,
  roleRequiresMfa,
  resolveMfaStatus,
  ROLES_REQUIRING_MFA,
  MFA_REQUIRED_MESSAGE,
} from "../lib/mfa-policy.ts";
import type { Role } from "../lib/auth-types.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASE = "http://localhost:3005";

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

/**
 * A faithful stand-in for withPrivilegedRoute: same order, same pure decision,
 * same response shape — but fed a status we control instead of Clerk's.
 */
function simulateGuardedCall(
  status: { required: boolean; satisfied: boolean },
  handler: () => { status: number; body: unknown },
): { status: number; body: unknown; handlerRan: boolean } {
  const outcome = mfaGateOutcome(status);
  if (!outcome.allow) {
    return {
      status: outcome.status,
      body: { error: outcome.error, code: outcome.code },
      handlerRan: false,
    };
  }
  const res = handler();
  return { ...res, handlerRan: true };
}

/** What lib/mfa.ts would produce for a given role and Clerk answer. */
function statusFor(role: Role | null, twoFactorEnabled: boolean) {
  const required = roleRequiresMfa(role);
  return { required, satisfied: required ? twoFactorEnabled : true };
}

async function main() {
  // ── 0: the enforcement toggle ───────────────────────────────────
  // Everything in section 1 describes behaviour that only applies while
  // enforcement is ON. This section proves the toggle gates all of it, and
  // that the Clerk call is never reached when it is off.
  step("0", "the MFA_ENFORCEMENT_ENABLED toggle");

  for (const role of ["HR", "SUPER_ADMIN", "MANAGER", "EMPLOYEE"] as const) {
    let clerkCalls = 0;
    const status = await resolveMfaStatus({
      enforcementEnabled: async () => false,
      realRole: async () => role,
      fetchUserFacts: async () => {
        clerkCalls++;
        return { twoFactorEnabled: false, totpEnabled: false, backupCodeEnabled: false };
      },
    });
    check(`toggle OFF — ${role} is not required to have MFA`, status.required === false);
    check(`toggle OFF — ${role} is satisfied (nothing blocks)`, status.satisfied === true);
    eq(`toggle OFF — ${role} made ZERO Clerk calls`, clerkCalls, 0);
    check(`toggle OFF — ${role} still resolves realRole for /mfa-required`, status.realRole === role);
    check(
      `toggle OFF — ${role} passes the API gate`,
      mfaGateOutcome(status).allow === true,
    );
  }

  for (const role of ["HR", "SUPER_ADMIN"] as const) {
    let clerkCalls = 0;
    const status = await resolveMfaStatus({
      enforcementEnabled: async () => true,
      realRole: async () => role,
      fetchUserFacts: async () => {
        clerkCalls++;
        return { twoFactorEnabled: false, totpEnabled: false, backupCodeEnabled: false };
      },
    });
    check(`toggle ON — ${role} without MFA is NOT satisfied`, status.satisfied === false);
    eq(`toggle ON — ${role} made exactly ONE Clerk call`, clerkCalls, 1);
    eq(`toggle ON — ${role} is blocked by the API gate`, mfaGateOutcome(status).allow, false);
  }

  // Manager/Employee never reach Clerk even with enforcement on — the role
  // rule short-circuits, exactly as before the toggle existed.
  for (const role of ["MANAGER", "EMPLOYEE"] as const) {
    let clerkCalls = 0;
    const status = await resolveMfaStatus({
      enforcementEnabled: async () => true,
      realRole: async () => role,
      fetchUserFacts: async () => {
        clerkCalls++;
        return { twoFactorEnabled: false, totpEnabled: false, backupCodeEnabled: false };
      },
    });
    check(`toggle ON — ${role} is still not required`, status.required === false);
    eq(`toggle ON — ${role} made ZERO Clerk calls`, clerkCalls, 0);
  }

  // Fail-closed on a Clerk outage, unchanged by the toggle work.
  const outage = await resolveMfaStatus({
    enforcementEnabled: async () => true,
    realRole: async () => "HR",
    fetchUserFacts: async () => {
      throw new Error("clerk unreachable");
    },
  });
  check("toggle ON — a Clerk outage fails CLOSED (not satisfied)", outage.satisfied === false);
  check("toggle ON — a Clerk outage still reports required", outage.required === true);

  // ── 1: the decision ─────────────────────────────────────────────
  // NOTE: everything below assumes enforcement is ON. Section 0 covers the off
  // state; these are the rules that apply once the Super Admin switches it on.
  step("1", "gate decision across every role × MFA state (enforcement ON)");
  eq("roles requiring MFA are unchanged", ROLES_REQUIRING_MFA, ["HR", "SUPER_ADMIN"]);

  for (const role of ["HR", "SUPER_ADMIN"] as const) {
    const blocked = mfaGateOutcome(statusFor(role, false));
    check(`${role} without MFA is BLOCKED`, blocked.allow === false);
    if (!blocked.allow) {
      eq(`${role} block code`, blocked.code, "MFA_REQUIRED");
      eq(`${role} block status`, blocked.status, 403);
      eq(`${role} block message`, blocked.error, MFA_REQUIRED_MESSAGE);
    }
    check(`${role} WITH MFA is allowed`, mfaGateOutcome(statusFor(role, true)).allow === true);
  }
  for (const role of ["EMPLOYEE", "MANAGER"] as const) {
    check(
      `${role} passes through even with MFA off (no Clerk call needed)`,
      mfaGateOutcome(statusFor(role, false)).allow === true,
    );
  }
  check(
    "an UNAUTHENTICATED caller (no role) passes through, so the handler still answers 401",
    mfaGateOutcome(statusFor(null, false)).allow === true,
  );
  check(
    "fail-closed: required but unsatisfied (Clerk unreachable) is BLOCKED",
    mfaGateOutcome({ required: true, satisfied: false }).allow === false,
  );

  // ── 1b: two previously-unwrapped routes, end to end ─────────────
  step("1b", "previously-unwrapped routes: /api/hr/payroll/run, /api/admin/user-role");

  // Each handler stands for the real one: it returns the status that route
  // would return on a successful HR call.
  const payrollRun = () => ({ status: 200, body: { ok: true, created: 12 } });
  const userRole = () => ({ status: 200, body: { ok: true, newRole: "MANAGER" } });
  const salaryStructure = () => ({ status: 200, body: { ok: true } });

  for (const [name, handler] of [
    ["/api/hr/payroll/run", payrollRun],
    ["/api/admin/user-role", userRole],
    ["/api/hr/salary-structure", salaryStructure],
  ] as const) {
    const denied = simulateGuardedCall(statusFor("HR", false), handler);
    eq(`${name} — HR without MFA → 403`, denied.status, 403);
    eq(`${name} — code is MFA_REQUIRED`, (denied.body as { code: string }).code, "MFA_REQUIRED");
    check(`${name} — the handler NEVER ran`, denied.handlerRan === false);

    const allowed = simulateGuardedCall(statusFor("HR", true), handler);
    eq(`${name} — HR WITH MFA → handler's own 200`, allowed.status, 200);
    check(`${name} — the handler ran`, allowed.handlerRan === true);
  }

  step("1c", "the gate never masks a handler's own error status");
  const badInput = () => ({ status: 400, body: { error: "bad", code: "BAD_INPUT" } });
  const conflict = () => ({ status: 409, body: { error: "dupe", code: "DUPLICATE_CODE" } });
  const wrongRole = () => ({ status: 403, body: { error: "no", code: "FORBIDDEN" } });
  for (const [label, h, expected] of [
    ["400 BAD_INPUT", badInput, 400],
    ["409 DUPLICATE_CODE", conflict, 409],
    ["403 FORBIDDEN (wrong role, not MFA)", wrongRole, 403],
  ] as const) {
    const r = simulateGuardedCall(statusFor("HR", true), h);
    eq(`MFA-enabled HR still gets ${label}`, r.status, expected);
  }
  const stillForbidden = simulateGuardedCall(statusFor("HR", true), wrongRole);
  eq(
    "a 403 from the handler keeps its OWN code, not MFA_REQUIRED",
    (stillForbidden.body as { code: string }).code,
    "FORBIDDEN",
  );

  // ── 2: coverage ─────────────────────────────────────────────────
  step("2", "every privileged route is wrapped");

  /**
   * The walk covers app/api/** ENTIRELY, and the default is "must be wrapped".
   *
   * It used to scan only app/api/hr and app/api/admin, which silently missed
   * three privileged routes that happen to live elsewhere — /api/payslip/[id],
   * /api/form16 and /api/resume/[applicationId] all serve HR the whole org's
   * salary or candidate data. Scanning by directory could never catch that,
   * because the gap WAS the directory assumption.
   *
   * So the rule is inverted: a route file is REQUIRED to be wrapped unless it
   * is listed below with a reason. A newly added route is, by default, not on
   * the list — so it fails this test until someone either wraps it or writes
   * down why it does not need wrapping. That is what makes this class of gap
   * unable to recur silently.
   */
  const EXEMPT: Record<string, string> = {
    // Not a Clerk session at all — authenticated by its own credential.
    "app/api/agent/heartbeat/route.ts": "desktop agent, AgentToken auth, no session",
    "app/api/webhooks/clerk/route.ts": "external webhook, svix signature auth, no session",
    // Deliberately public.
    "app/api/careers/apply/route.ts": "public job application form, unauthenticated by design",
    // Self-service: the caller can only ever reach their OWN record, so there
    // is no org-wide data behind them for a second factor to protect.
    "app/api/attendance/punch/route.ts": "employee self-service, own punches only",
    "app/api/attendance/month/route.ts": "employee self-service, own month only",
    "app/api/employee/warning/acknowledge/route.ts": "employee self-service, own warning only",
    "app/api/community/shoutout/route.ts": "employee self-service",
    "app/api/pulse/respond/route.ts": "employee self-service, own survey response",
    // MANAGER is not in ROLES_REQUIRING_MFA, and these are scoped to the
    // caller's own team in-route, so the wrapper would be a no-op.
    "app/api/manager/appraisal/feedback/route.ts": "manager scope, MANAGER does not require MFA",
    "app/api/manager/client-mail/route.ts": "manager scope, MANAGER does not require MFA",
    "app/api/manager/expense/route.ts": "manager scope, MANAGER does not require MFA",
    "app/api/manager/leave/route.ts": "manager scope, MANAGER does not require MFA",
    "app/api/manager/quality/route.ts": "manager scope, MANAGER does not require MFA",
    "app/api/manager/shift/route.ts": "manager scope, MANAGER does not require MFA",
    "app/api/manager/target/route.ts": "manager scope, MANAGER does not require MFA",
    "app/api/manager/warning/route.ts": "manager scope, MANAGER does not require MFA",
    // NOTE: app/api/search/route.ts was exempt here until the self-audit found
    // the justification ("results scoped per role in-route") was true only for
    // EMPLOYEE and MANAGER. The HR/SUPER_ADMIN branch reads org-wide across
    // Employee (incl. email), Candidate and JobRequisition, so it is now
    // wrapped like every other privileged route and is deliberately NOT listed.
    // Has its own equivalent MFA check inline — asserted separately below.
    "app/api/reports/[report]/route.ts": "own in-route mfaStatus() check, not double-wrapped",
  };

  const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "route.ts") files.push(p);
    }
  };
  walk(path.join(ROOT, "app/api"));

  const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/");
  const seen = new Set(files.map(rel));

  // A stale exemption is its own hazard: a path that no longer exists means the
  // list has drifted, and a future route could land on that path pre-excused.
  for (const p of Object.keys(EXEMPT)) {
    check(`exemption still points at a real file: ${p}`, seen.has(p));
  }

  const required = files.filter((f) => !(rel(f) in EXEMPT));

  // These totals are expected to grow as routes are added — they are a tripwire
  // for a route appearing or vanishing unnoticed, not the real guarantee. The
  // guarantee is the "NO route exports an unwrapped handler" assertion below,
  // which holds at any count.
  //   36/38 at introduction (MFA wrapper phase), scanning hr/ + admin/ only
  //   38/40 after Phase 13 added /api/hr/attendance/correct and
  //         /api/hr/employee/retention
  //   41/43 after the walk widened to all of app/api and picked up the three
  //         privileged routes it had never been looking at
  eq("59 route files under app/api in total", files.length, 59);
  eq("17 documented exemptions", Object.keys(EXEMPT).length, 17);
  eq("42 route files REQUIRE the wrapper", required.length, 42);

  let unwrapped = 0;
  let handlerCount = 0;
  for (const file of required) {
    const src = fs.readFileSync(file, "utf8");
    const r = rel(file);

    // A raw `export async function POST` means the method is exposed WITHOUT
    // the gate — exactly the state this task existed to remove.
    for (const m of METHODS) {
      if (new RegExp(`^export async function ${m}\\s*\\(`, "m").test(src)) {
        unwrapped++;
        console.log(`        UNWRAPPED: ${m} in ${r}`);
      }
    }
    for (const m of METHODS) {
      if (new RegExp(`^async function ${m}Handler\\s*\\(`, "m").test(src)) {
        handlerCount++;
        const exported = new RegExp(
          `^export const ${m} = withPrivilegedRoute\\(${m}Handler\\);`,
          "m",
        ).test(src);
        if (!exported) {
          unwrapped++;
          console.log(`        HANDLER NOT RE-EXPORTED: ${m} in ${r}`);
        }
      }
    }
    if (!src.includes('from "@/lib/mfa-guard"')) {
      unwrapped++;
      console.log(`        MISSING IMPORT: ${r}`);
    }
  }
  eq("44 handlers wrapped (2 files export two methods each)", handlerCount, 44);
  check("NO route exports an unwrapped handler", unwrapped === 0, `${unwrapped} problem(s)`);

  // ── 2b: the three routes the old directory-scoped walk missed ───
  step("2b", "the routes that lived outside hr/ and admin/");
  for (const p of [
    "app/api/payslip/[id]/route.ts",
    "app/api/form16/route.ts",
    "app/api/resume/[applicationId]/route.ts",
  ]) {
    const src = fs.readFileSync(path.join(ROOT, p), "utf8");
    check(
      `${p} is MFA-gated`,
      src.includes('from "@/lib/mfa-guard"') &&
        /^export const GET = withPrivilegedRoute\(GETHandler\);/m.test(src) &&
        !/^export async function GET\s*\(/m.test(src),
    );
    check(`${p} is NOT exempt (the walk genuinely requires it)`, !(p in EXEMPT));
  }

  // The reports route has its own in-route check and is deliberately exempt.
  const reports = fs.readFileSync(
    path.join(ROOT, "app/api/reports/[report]/route.ts"),
    "utf8",
  );
  check(
    "the reports route keeps its own MFA check (not double-wrapped)",
    reports.includes("mfaStatus") &&
      reports.includes("MFA_REQUIRED") &&
      !reports.includes("withPrivilegedRoute"),
  );
}

async function httpLayer() {
  step("3", "over HTTP — the gate does not mask existing status codes");
  const targets = [
    "/api/hr/payroll/run",
    "/api/admin/user-role",
    "/api/hr/salary-structure",
    "/api/hr/employee",
  ];
  try {
    for (const t of targets) {
      const res = await fetch(`${BASE}${t}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await res.json()) as { code?: string };
      check(
        `${t} — unauthenticated is still 401 UNAUTHENTICATED, NOT 403 MFA_REQUIRED`,
        res.status === 401 && body.code === "UNAUTHENTICATED",
        `status ${res.status} code ${body.code}`,
      );
    }
    const letter = await fetch(`${BASE}/api/hr/offer/letter/abc123`);
    const lBody = (await letter.json()) as { code?: string };
    check(
      "the dynamic-segment route still resolves and answers 401",
      letter.status === 401 && lBody.code === "UNAUTHENTICATED",
      `status ${letter.status} code ${lBody.code}`,
    );
  } catch (e) {
    check("HTTP layer ran (is `npm run dev` up on :3005?)", false,
      e instanceof Error ? e.message : String(e));
  }
}

async function run() {
  await main();
  await httpLayer();
  console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
  if (fail > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error("VERIFY CRASHED:", err);
  process.exitCode = 1;
});
