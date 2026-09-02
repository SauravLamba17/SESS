/**
 * CATEGORY 4 — REDACTED-EMPLOYEE ROBUSTNESS.
 *
 * Phase 13's retention system redacts a former employee's personal identifiers
 * in place, keeping every financial record. That makes "a redacted Employee row
 * with null email / null dateOfBirth / '[REDACTED]' emergencyContact" a REAL,
 * REACHABLE state — and one nothing had specifically tested.
 *
 * This proves:
 *   1. redaction touches exactly the four documented fields and nothing else
 *   2. the fields every report/payslip reads are the PRESERVED ones, so those
 *      surfaces cannot meet a redacted null at all
 *   3. the two write paths that could REVERSE a redaction now refuse to
 *
 * Creates a real employee, offboards and redacts it through the real pure
 * functions, then deletes everything.
 *
 * Run:  npx tsx prisma/verify-redaction-robustness.ts
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  redactionPatch,
  scheduledRedactionFor,
  checkEligibility,
  REDACTED_FIELDS,
  PRESERVED_FIELDS,
  REDACTION_MARKER,
} from "../lib/employees/retention.ts";
import { sendEmployeeInvitation } from "../lib/employees/invite.ts";

const db = new PrismaClient();
const ROOT = path.resolve(import.meta.dirname, "..");
const TAG = "ZZ-REDACT";

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

async function cleanup() {
  const emps = await db.employee.findMany({
    where: { employeeCode: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = emps.map((e) => e.id);
  if (ids.length) await db.user.deleteMany({ where: { employeeId: { in: ids } } });
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: TAG } } });
  await db.auditLog.deleteMany({ where: { actorUserId: TAG } });
}

async function main() {
  await cleanup();

  // ── 1: what redaction actually does ───────────────────────────
  step("1", "redaction touches exactly four fields");
  eq("REDACTED_FIELDS is the documented set", [...REDACTED_FIELDS].sort(), [
    "dateOfBirth", "email", "emergencyContact", "pendingInvitationId",
  ]);
  check(
    "name and employeeCode are PRESERVED, not redacted",
    PRESERVED_FIELDS.includes("name") &&
      PRESERVED_FIELDS.includes("employeeCode") &&
      !(REDACTED_FIELDS as readonly string[]).includes("name"),
  );

  const lastDay = new Date(2019, 0, 15);
  const emp = await db.employee.create({
    data: {
      employeeCode: `${TAG}-1`,
      name: `${TAG} Former Employee`,
      department: "Assembly",
      designation: "Operator",
      joiningDate: new Date(2015, 0, 1),
      email: `${TAG.toLowerCase()}-1@example.invalid`,
      emergencyContact: "Jane Doe 555-0100",
      dateOfBirth: new Date(1990, 4, 20),
      pendingInvitationId: "inv_stale",
      active: false,
      offboardedAt: lastDay,
      scheduledRedactionAt: scheduledRedactionFor(lastDay),
    },
  });

  const elig = checkEligibility({
    active: false, offboardedAt: lastDay,
    scheduledRedactionAt: scheduledRedactionFor(lastDay), redactedAt: null,
  });
  check("a 2019 leaver is due for redaction today", elig.ok === true);

  const redacted = await db.employee.update({
    where: { id: emp.id },
    data: redactionPatch(),
  });

  eq("email → null", redacted.email, null);
  eq("dateOfBirth → null", redacted.dateOfBirth, null);
  eq("pendingInvitationId → null", redacted.pendingInvitationId, null);
  eq("emergencyContact → marker (a STRING, never null)", redacted.emergencyContact, REDACTION_MARKER);
  check("redactedAt stamped", redacted.redactedAt !== null);
  eq("name PRESERVED", redacted.name, `${TAG} Former Employee`);
  eq("employeeCode PRESERVED", redacted.employeeCode, `${TAG}-1`);
  eq("department PRESERVED", redacted.department, "Assembly");
  eq("designation PRESERVED", redacted.designation, "Operator");
  check("offboardedAt PRESERVED (pro-ration depends on it)", redacted.offboardedAt !== null);

  // ── 2: the read surfaces cannot meet a redacted null ──────────
  step("2", "reports and payslips read only PRESERVED fields");

  const scopeSrc = fs.readFileSync(path.join(ROOT, "lib/reports/scope.ts"), "utf8");
  const sel = scopeSrc.slice(scopeSrc.indexOf("const EMPLOYEE_SELECT"), scopeSrc.indexOf("} as const"));
  for (const f of REDACTED_FIELDS) {
    check(`reports' EMPLOYEE_SELECT does not read ${f}`, !new RegExp(`\\b${f}\\s*:\\s*true`).test(sel));
  }
  const payslipSrc = fs.readFileSync(path.join(ROOT, "app/api/payslip/[id]/route.ts"), "utf8");
  const f16Src = fs.readFileSync(path.join(ROOT, "app/api/form16/route.ts"), "utf8");
  for (const [name, src] of [["payslip", payslipSrc], ["form16", f16Src]] as const) {
    for (const f of REDACTED_FIELDS) {
      check(`${name} does not read ${f}`, !new RegExp(`\\b${f}\\s*:\\s*true`).test(src));
    }
  }

  // A redacted ex-employee's payslip must still render with a real identity —
  // that is precisely why `name` is preserved.
  check(
    "a redacted employee still has everything a payslip needs",
    Boolean(redacted.name && redacted.employeeCode && redacted.department),
    `name=${redacted.name} code=${redacted.employeeCode}`,
  );

  // The one report that DOES read them guards both.
  const myData = fs.readFileSync(path.join(ROOT, "lib/reports/pdf/my-data.tsx"), "utf8");
  check("my-data PDF guards email with a fallback", /p\.email \?\? "—"/.test(myData));
  check("my-data PDF guards emergencyContact with a fallback", /p\.emergencyContact \?\? "—"/.test(myData));

  // The birthday widget must skip a null dateOfBirth rather than throw.
  const logic = fs.readFileSync(path.join(ROOT, "lib/engagement/logic.ts"), "utf8");
  check("birthday widget guards a null dateOfBirth", /e\.dateOfBirth &&/.test(logic));

  // ── 3: redaction cannot be reversed by a write path ───────────
  step("3", "the two write paths refuse a redacted employee");

  // (a) HR re-inviting a redacted ex-employee would write email +
  //     pendingInvitationId back — the exact two fields redaction nulls.
  // No Clerk account owns these throwaway addresses, so every case below
  // takes the ordinary invitation path rather than the link-now path.
  const noClerkUser = async () => null;
  let clerkCalled = false;
  const invite = await sendEmployeeInvitation(
    db,
    { employeeId: emp.id, email: "new.address@example.invalid", role: "EMPLOYEE", actorUserId: TAG },
    async () => {
      clerkCalled = true;
      return { id: "inv_should_not_happen" };
    },
    noClerkUser,
  );
  check("invite REFUSED for a redacted employee", invite.ok === false);
  eq("…with code REDACTED", invite.ok === false ? invite.code : null, "REDACTED");
  check("…and Clerk was never called", clerkCalled === false);

  const after = await db.employee.findUnique({ where: { id: emp.id } });
  eq("…email is STILL null (redaction not reversed)", after!.email, null);
  eq("…pendingInvitationId is STILL null", after!.pendingInvitationId, null);

  // (b) An offboarded-but-not-redacted employee is refused too.
  const emp2 = await db.employee.create({
    data: {
      employeeCode: `${TAG}-2`,
      name: `${TAG} Offboarded`,
      department: "Assembly",
      joiningDate: new Date(2015, 0, 1),
      email: `${TAG.toLowerCase()}-2@example.invalid`,
      active: false,
      offboardedAt: lastDay,
    },
  });
  const invite2 = await sendEmployeeInvitation(
    db,
    { employeeId: emp2.id, role: "EMPLOYEE", actorUserId: TAG },
    async () => ({ id: "inv_nope" }),
    noClerkUser,
  );
  check("invite REFUSED for an offboarded employee", invite2.ok === false);
  eq("…with code INACTIVE", invite2.ok === false ? invite2.code : null, "INACTIVE");

  // (c) An ACTIVE employee is still invitable — the guard must not over-block.
  const emp3 = await db.employee.create({
    data: {
      employeeCode: `${TAG}-3`,
      name: `${TAG} Current`,
      department: "Assembly",
      joiningDate: new Date(2015, 0, 1),
      email: `${TAG.toLowerCase()}-3@example.invalid`,
    },
  });
  const invite3 = await sendEmployeeInvitation(
    db,
    { employeeId: emp3.id, role: "EMPLOYEE", actorUserId: TAG },
    async () => ({ id: "inv_ok" }),
    noClerkUser,
  );
  check("an ACTIVE employee is STILL invitable (no over-block)", invite3.ok === true);

  // (d) The self-service profile write is guarded in source — an offboarded
  //     employee keeps their Clerk account, so this path stays reachable.
  const profileSrc = fs.readFileSync(path.join(ROOT, "app/employee/profile/actions.ts"), "utf8");
  check("updateProfile refuses a redacted employee", /if \(employee\.redactedAt\)/.test(profileSrc));
  check("updateProfile refuses an inactive employee", /if \(!employee\.active\)/.test(profileSrc));
  const gIdx = profileSrc.indexOf("employee.redactedAt");
  const wIdx = profileSrc.indexOf("db.employee.update");
  check("…and both guards run BEFORE the write", gIdx > 0 && gIdx < wIdx);
}

main()
  .then(async () => {
    console.log("\n── CLEANUP ───────────────────────────────────────────");
    await cleanup();
    eq("every test row removed", await db.employee.count({ where: { employeeCode: { startsWith: TAG } } }), 0);
    console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
    if (fail > 0) process.exitCode = 1;
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error("VERIFY CRASHED:", e);
    await cleanup().catch(() => {});
    await db.$disconnect();
    process.exitCode = 1;
  });
