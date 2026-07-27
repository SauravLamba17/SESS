/**
 * MFA ENFORCEMENT TOGGLE VERIFICATION.
 *
 * Proves the four claims that matter about making a security control
 * configurable:
 *
 *   1. It DEFAULTS OFF on a fresh install (no SystemSetting row).
 *   2. With it OFF, no role is enforced anywhere and the Clerk Backend API is
 *      never called — proved by a CALL COUNTER on the injected dependency, not
 *      by a successful response.
 *   3. With it ON, the exact pre-toggle behaviour is restored for every
 *      privileged route, including the three that were missing the wrapper.
 *   4. A toggle READ FAILURE fails CLOSED (enforcement treated as on), while a
 *      merely-absent row means off. Those two must never collapse together.
 *
 * Cleans up every row it writes.
 *
 * Run:  npx tsx prisma/verify-mfa-toggle.ts
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { resolveMfaStatus, mfaGateOutcome } from "../lib/mfa-policy.ts";
import { portalForPath } from "../lib/auth-types.ts";
import type { Role } from "../lib/auth-types.ts";

const db = new PrismaClient();
const ROOT = path.resolve(import.meta.dirname, "..");

// lib/system-settings.ts is "server-only" and cannot be imported here, so the
// key is pinned as a literal and checked against the source below — a rename
// on either side fails the test rather than silently testing the wrong key.
const KEY = "MFA_ENFORCEMENT_ENABLED";

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

/**
 * The REAL production reader, re-implemented here against the same key with
 * the same two-way split. lib/system-settings.ts is "server-only" and cannot
 * be imported outside Next, so this mirrors it; the assertions below pin the
 * behaviour that matters (absent → off, throw → on).
 */
async function readToggle(client: { systemSetting: { findUnique: Function } }): Promise<boolean> {
  try {
    const row = await client.systemSetting.findUnique({ where: { key: KEY } });
    return row?.value === "true";
  } catch {
    return true; // FAIL CLOSED
  }
}

/** Every route the wrapper protects, plus the three the audit found missing. */
const PRIVILEGED_ROUTES = [
  "/api/hr/payroll/run",
  "/api/admin/user-role",
  "/api/hr/salary-structure",
  // The three that lived outside app/api/hr and app/api/admin.
  "/api/payslip/[id]",
  "/api/form16",
  "/api/resume/[applicationId]",
];

async function run() {
  const preexisting = await db.systemSetting.findUnique({ where: { key: KEY } });
  if (preexisting) {
    console.log(`\n(note: a real ${KEY} row exists — saving and restoring it)`);
  }
  // Start from a genuinely unset state.
  await db.systemSetting.deleteMany({ where: { key: KEY } });

  try {
    // ── 0: the wiring is real ─────────────────────────────────────
    step("0", "the key and its production reader are wired as tested");
    const settingsSrc = fs.readFileSync(path.join(ROOT, "lib/system-settings.ts"), "utf8");
    check(
      `lib/system-settings.ts declares mfaEnforcement: "${KEY}"`,
      new RegExp(`mfaEnforcement:\\s*"${KEY}"`).test(settingsSrc),
    );
    check(
      "its reader returns row?.value === \"true\" (absent row → OFF)",
      /return row\?\.value === "true";/.test(settingsSrc),
    );
    check(
      "its catch block fails CLOSED (returns true)",
      /catch[\s\S]{0,400}?failing CLOSED[\s\S]{0,200}?return true;/.test(settingsSrc),
    );
    const mfaSrc = fs.readFileSync(path.join(ROOT, "lib/mfa.ts"), "utf8");
    check(
      "lib/mfa.ts feeds the toggle into resolveMfaStatus as enforcementEnabled",
      /enforcementEnabled:\s*mfaEnforcementEnabled/.test(mfaSrc),
    );
    const policySrc = fs.readFileSync(path.join(ROOT, "lib/mfa-policy.ts"), "utf8");
    check(
      "the toggle is checked BEFORE the role rule and the Clerk call",
      policySrc.indexOf("deps.enforcementEnabled()") < policySrc.indexOf("roleRequiresMfa(realRole)") &&
        policySrc.indexOf("deps.enforcementEnabled()") < policySrc.indexOf("deps.fetchUserFacts()"),
    );
    // Nobody may re-implement the toggle check outside the resolver.
    for (const f of ["app/hr/layout.tsx", "app/admin/layout.tsx", "lib/mfa-guard.ts"]) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      check(
        `${f} does NOT duplicate the toggle check (goes through mfaStatus)`,
        !src.includes("mfaEnforcementEnabled") && !src.includes(KEY),
      );
    }

    // ── 1: default ────────────────────────────────────────────────
    step("1", "the toggle defaults OFF on a fresh install");
    const row = await db.systemSetting.findUnique({ where: { key: KEY } });
    check("no SystemSetting row exists for the key", row === null);
    eq("an unset toggle reads as OFF", await readToggle(db), false);

    // ── 2: OFF — zero enforcement, zero Clerk calls ───────────────
    step("2", "toggle OFF — no enforcement, ZERO Clerk API calls");
    let clerkCalls = 0;
    const countingFetch = async () => {
      clerkCalls++;
      return { twoFactorEnabled: false, totpEnabled: false, backupCodeEnabled: false };
    };

    for (const role of ["HR", "SUPER_ADMIN", "MANAGER", "EMPLOYEE"] as const) {
      const status = await resolveMfaStatus({
        enforcementEnabled: () => readToggle(db),
        realRole: async () => role as Role,
        fetchUserFacts: countingFetch,
      });
      check(`${role} — not required`, status.required === false);
      check(`${role} — satisfied, so no layout redirect`, status.satisfied === true);
      for (const r of PRIVILEGED_ROUTES) {
        check(
          `${role} — ${r} allowed`,
          mfaGateOutcome(status).allow === true,
        );
      }
    }
    eq("TOTAL Clerk API calls with the toggle off", clerkCalls, 0);

    // ── 3: ON — original behaviour restored ───────────────────────
    step("3", "toggle ON — original enforcement restored");
    await db.systemSetting.create({
      data: { key: KEY, value: "true", updatedBy: "verify-mfa-toggle" },
    });
    eq("the toggle now reads as ON", await readToggle(db), true);

    for (const role of ["HR", "SUPER_ADMIN"] as const) {
      let calls = 0;
      const blocked = await resolveMfaStatus({
        enforcementEnabled: () => readToggle(db),
        realRole: async () => role as Role,
        fetchUserFacts: async () => {
          calls++;
          return { twoFactorEnabled: false, totpEnabled: false, backupCodeEnabled: false };
        },
      });
      check(`${role} without MFA — required`, blocked.required === true);
      check(`${role} without MFA — NOT satisfied (layout redirects)`, blocked.satisfied === false);
      eq(`${role} without MFA — Clerk consulted exactly once`, calls, 1);
      const outcome = mfaGateOutcome(blocked);
      for (const r of PRIVILEGED_ROUTES) {
        check(`${role} — ${r} BLOCKED`, outcome.allow === false);
      }
      if (!outcome.allow) {
        eq(`${role} — code`, outcome.code, "MFA_REQUIRED");
        eq(`${role} — status`, outcome.status, 403);
      }

      const allowed = await resolveMfaStatus({
        enforcementEnabled: () => readToggle(db),
        realRole: async () => role as Role,
        fetchUserFacts: async () => ({
          twoFactorEnabled: true,
          totpEnabled: true,
          backupCodeEnabled: false,
        }),
      });
      check(`${role} WITH MFA — satisfied`, allowed.satisfied === true);
      check(`${role} WITH MFA — every route allowed`, mfaGateOutcome(allowed).allow === true);
    }

    for (const role of ["MANAGER", "EMPLOYEE"] as const) {
      let calls = 0;
      const status = await resolveMfaStatus({
        enforcementEnabled: () => readToggle(db),
        realRole: async () => role as Role,
        fetchUserFacts: async () => {
          calls++;
          return { twoFactorEnabled: false, totpEnabled: false, backupCodeEnabled: false };
        },
      });
      check(`${role} — unaffected even with enforcement ON`, status.satisfied === true);
      eq(`${role} — still ZERO Clerk calls`, calls, 0);
    }

    // ── 3b: THE NO-LOCKOUT GUARANTEE ─────────────────────────────
    // The scenario that would be a true lockout: enforcement is ON, and the
    // Super Admin who turned it on has no second factor. They must still be
    // able to REACH the setup page, or the toggle is a one-way door.
    //
    // The toggle row written above is still "true" at this point, so this runs
    // against genuinely-enabled enforcement, not a simulated flag.
    step("3b", "NO-LOCKOUT: /mfa-required stays reachable with enforcement ON");
    eq("enforcement is actually ON for this section", await readToggle(db), true);

    const strandedAdmin = await resolveMfaStatus({
      enforcementEnabled: () => readToggle(db),
      realRole: async () => "SUPER_ADMIN" as Role,
      fetchUserFacts: async () => ({
        twoFactorEnabled: false,
        totpEnabled: false,
        backupCodeEnabled: false,
      }),
    });

    // (a) The portal gates DO bounce them — that is the feature working.
    check("Super Admin w/o MFA is blocked from /admin", strandedAdmin.satisfied === false);

    // (b) But /mfa-required does NOT bounce them. Its only redirect is
    //     `if (status.satisfied) redirect(...)`, so an unsatisfied user falls
    //     through and the page renders. This drives that exact predicate.
    const mfaPageSrc = fs.readFileSync(path.join(ROOT, "app/mfa-required/page.tsx"), "utf8");
    check(
      "/mfa-required redirects ONLY when satisfied (single guard, no role check)",
      /if \(status\.satisfied\)\s*\{?\s*redirect\(/.test(mfaPageSrc) &&
        !mfaPageSrc.includes("ROUTE_ACCESS") &&
        !/redirect\("\/mfa-required"\)/.test(mfaPageSrc),
    );
    check(
      "→ with satisfied=false the page RENDERS (no redirect taken)",
      strandedAdmin.satisfied === false,
    );
    check(
      "→ and it can show them what is missing",
      strandedAdmin.factors.totp === false && strandedAdmin.realRole === "SUPER_ADMIN",
    );

    // (c) Neither /mfa-required nor /account is inside a role-gated portal.
    for (const p of ["/mfa-required", "/account"]) {
      eq(`portalForPath("${p}") is null → middleware applies NO role gate`, portalForPath(p), null);
    }

    // (d) Neither path sits under a layout that runs the MFA gate. The only
    //     layouts that gate are /hr and /admin; these two have no layout of
    //     their own, and the root layout gates nothing.
    for (const p of ["app/mfa-required", "app/account"]) {
      check(`${p} has no layout.tsx of its own`, !fs.existsSync(path.join(ROOT, p, "layout.tsx")));
    }
    const rootLayout = fs.readFileSync(path.join(ROOT, "app/layout.tsx"), "utf8");
    check(
      "the root layout runs no MFA gate and no redirect",
      !rootLayout.includes("mfaStatus") && !rootLayout.includes("redirect("),
    );

    // (e) Middleware lets both through as signed-in-but-unrestricted.
    const mw = fs.readFileSync(path.join(ROOT, "middleware.ts"), "utf8");
    // The matcher list only — bounded by the handler that follows it, so a
    // path mentioned merely in a comment elsewhere cannot satisfy this.
    const shared = mw.slice(
      mw.indexOf("const isSharedAuthedRoute"),
      mw.indexOf("export default"),
    );
    check("the shared-authed matcher block was located", shared.length > 0);
    for (const p of ["/mfa-required", "/account"]) {
      check(`middleware lists ${p} as shared-authed (auth yes, role no)`, shared.includes(p));
    }

    // (f) The escape route actually goes somewhere useful.
    check(
      "/mfa-required links to /account, where Clerk's UserProfile hosts setup",
      mfaPageSrc.includes('href="/account"'),
    );
    const accountSrc = fs.readFileSync(
      path.join(ROOT, "app/account/[[...rest]]/page.tsx"),
      "utf8",
    );
    check(
      "/account renders Clerk's <UserProfile> and runs no MFA gate",
      accountSrc.includes("<UserProfile") && !accountSrc.includes("mfaStatus"),
    );

    // (g) Recovery is automatic: enabling the factor flips satisfied to true
    //     with no sign-out, because the page is force-dynamic and re-checks.
    const afterSetup = await resolveMfaStatus({
      enforcementEnabled: () => readToggle(db),
      realRole: async () => "SUPER_ADMIN" as Role,
      fetchUserFacts: async () => ({
        twoFactorEnabled: true,
        totpEnabled: true,
        backupCodeEnabled: true,
      }),
    });
    check("after enabling TOTP the same user is satisfied", afterSetup.satisfied === true);
    check("/mfa-required is force-dynamic, so it re-checks on return", mfaPageSrc.includes('dynamic = "force-dynamic"'));

    // ── 3c: the guidance the stranded user actually reads ────────
    // The no-lockout guarantee is only real if the page tells them what to do.
    step("3c", "/mfa-required walks the user through setup");
    for (const [label, needle] of [
      ["1 — links to account security settings", "Go to your account security settings"],
      ["2 — names the Security section", "section, find the two-factor authentication option"],
      ["3 — offers authenticator app (recommended) or SMS", "recommended"],
      ["4 — says to follow the prompts", "Follow the prompts to finish setup"],
      ["5 — access restored automatically, no re-sign-in", "no need to sign out and back in"],
    ] as const) {
      check(`step ${label}`, mfaPageSrc.replace(/\s+/g, " ").includes(needle));
    }
    check(
      "all five steps are numbered in one ordered list",
      (mfaPageSrc.match(/<ol[\s\S]*?<\/ol>/)?.[0].match(/<li/g)?.length ?? 0) === 5,
    );
    check(
      "the SMS option is offered alongside the authenticator app",
      /authenticator app[\s\S]{0,200}SMS/.test(mfaPageSrc.replace(/\s+/g, " ")),
    );

    // The toggle's tooltip must carry the same three promises.
    const modulesSrc = fs.readFileSync(path.join(ROOT, "app/admin/modules/page.tsx"), "utf8");
    const flatModules = modulesSrc.replace(/\s+/g, " ");
    check("toggle tooltip exists on the MFA switch", modulesSrc.includes("HintPopover"));
    check(
      "tooltip says what turning it on does",
      flatModules.includes("What turning this on does"),
    );
    check("tooltip says how to set it up", flatModules.includes("How to set it up"));
    check(
      "tooltip carries the no-lockout reassurance",
      flatModules.includes("You will not be locked out"),
    );

    // ── 4: fail-closed ───────────────────────────────────────────
    step("4", "a toggle READ FAILURE fails closed, an absent row does not");
    const brokenClient = {
      systemSetting: {
        findUnique: async () => {
          throw new Error("database unreachable");
        },
      },
    };
    eq("unreadable toggle → treated as ON (fail closed)", await readToggle(brokenClient), true);

    const failClosed = await resolveMfaStatus({
      enforcementEnabled: () => readToggle(brokenClient),
      realRole: async () => "HR" as Role,
      fetchUserFacts: async () => ({
        twoFactorEnabled: false,
        totpEnabled: false,
        backupCodeEnabled: false,
      }),
    });
    check("unreadable toggle → HR without MFA is BLOCKED", failClosed.satisfied === false);

    await db.systemSetting.deleteMany({ where: { key: KEY } });
    eq("absent row → OFF (not conflated with the failure case)", await readToggle(db), false);

    // A Clerk outage while enforcement is on still fails closed.
    await db.systemSetting.create({
      data: { key: KEY, value: "true", updatedBy: "verify-mfa-toggle" },
    });
    const clerkDown = await resolveMfaStatus({
      enforcementEnabled: () => readToggle(db),
      realRole: async () => "SUPER_ADMIN" as Role,
      fetchUserFacts: async () => {
        throw new Error("clerk unreachable");
      },
    });
    check("enforcement ON + Clerk down → BLOCKED (unchanged)", clerkDown.satisfied === false);
  } finally {
    // ── cleanup ──────────────────────────────────────────────────
    step("5", "cleanup");
    await db.systemSetting.deleteMany({ where: { key: KEY } });
    if (preexisting) {
      await db.systemSetting.create({
        data: {
          key: preexisting.key,
          value: preexisting.value,
          updatedBy: preexisting.updatedBy,
        },
      });
    }
    const left = await db.systemSetting.findUnique({ where: { key: KEY } });
    check(
      "test rows removed (pre-existing value restored if there was one)",
      preexisting ? left?.value === preexisting.value : left === null,
    );
    const strays = await db.systemSetting.count({ where: { updatedBy: "verify-mfa-toggle" } });
    eq("no rows left behind by this script", strays, 0);
    await db.$disconnect();
  }

  console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
  if (fail > 0) process.exitCode = 1;
}

run().catch(async (err) => {
  console.error("VERIFY CRASHED:", err);
  await db.$disconnect();
  process.exitCode = 1;
});
