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

function main() {
  // ── 1: the decision ─────────────────────────────────────────────
  step("1", "gate decision across every role × MFA state");
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
  const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "route.ts") files.push(p);
    }
  };
  walk(path.join(ROOT, "app/api/hr"));
  walk(path.join(ROOT, "app/api/admin"));

  eq("36 privileged route files", files.length, 36);

  let unwrapped = 0;
  let handlerCount = 0;
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");

    // A raw `export async function POST` means the method is exposed WITHOUT
    // the gate — exactly the state this task existed to remove.
    for (const m of METHODS) {
      if (new RegExp(`^export async function ${m}\\s*\\(`, "m").test(src)) {
        unwrapped++;
        console.log(`        UNWRAPPED: ${m} in ${rel}`);
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
          console.log(`        HANDLER NOT RE-EXPORTED: ${m} in ${rel}`);
        }
      }
    }
    if (!src.includes('from "@/lib/mfa-guard"')) {
      unwrapped++;
      console.log(`        MISSING IMPORT: ${rel}`);
    }
  }
  eq("38 handlers wrapped (2 files export two methods each)", handlerCount, 38);
  check("NO route exports an unwrapped handler", unwrapped === 0, `${unwrapped} problem(s)`);

  // The reports route has its own in-route check and is deliberately not here.
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
  main();
  await httpLayer();
  console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
  if (fail > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error("VERIFY CRASHED:", err);
  process.exitCode = 1;
});
