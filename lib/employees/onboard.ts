// Deliberately NOT marked `server-only`: this module imports a Prisma TYPE and
// nothing else — no db client, no next/headers, no secrets — and every function
// takes a TransactionClient the caller must supply, which a client component
// could never construct. Keeping it importable lets the verification scripts
// exercise the real onboarding path instead of a copy of it.
import type { Prisma } from "@prisma/client";

/**
 * The ONE place an Employee record is created.
 *
 * Two callers, one implementation:
 *   1. app/api/hr/employee/route.ts      — HR onboarding an employee by hand (Phase 5)
 *   2. app/api/hr/offer/status/route.ts  — hire-conversion when an offer is ACCEPTED (Phase 8)
 *
 * Phase 8's brief is explicit that hire-conversion must not duplicate Phase 5's
 * logic. It doesn't: Phase 5's route was refactored to call this function, so
 * employeeCode uniqueness, manager validation and the EMPLOYEE_ONBOARDED audit
 * row behave identically no matter which path creates the employee. Change the
 * rules here and both flows change together.
 *
 * Everything takes a transaction client so the caller controls the boundary —
 * hire-conversion needs the employee, salary structure, onboarding tasks and
 * application stage-change to all commit or all roll back together.
 */

export type Tx = Prisma.TransactionClient;

export interface OnboardInput {
  /** Supplied by HR on the manual flow; auto-generated on hire-conversion. */
  employeeCode?: string | null;
  name: string;
  department: string;
  designation?: string | null;
  managerId?: string | null;
  machineId?: string | null;
  joiningDate: Date;
  /**
   * Optional — stored lowercased. This is how the Clerk webhook later
   * correlates an accepted invitation back to this Employee. Invitation
   * SENDING deliberately lives outside this function (lib/employees/invite.ts),
   * so an external API call never sits inside a caller's transaction.
   */
  email?: string | null;
}

export type OnboardResult =
  | { ok: true; employee: { id: string; employeeCode: string; name: string } }
  | {
      ok: false;
      code: "DUPLICATE_CODE" | "DUPLICATE_EMAIL" | "BAD_MANAGER" | "BAD_INPUT";
      message: string;
    };

/**
 * Next free employee code in the EMP-#### series.
 *
 * Reads the highest existing numeric suffix rather than counting rows, so
 * codes never collide with an offboarded employee's retained record. The DB's
 * unique index on employeeCode remains the real guarantee — a concurrent
 * create still surfaces as P2002, which callers map to DUPLICATE_CODE.
 */
export async function nextEmployeeCode(tx: Tx): Promise<string> {
  const rows = await tx.employee.findMany({
    where: { employeeCode: { startsWith: "EMP-" } },
    select: { employeeCode: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt(r.employeeCode.slice(4), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `EMP-${String(max + 1).padStart(4, "0")}`;
}

/**
 * Create an Employee + its EMPLOYEE_ONBOARDED audit row.
 *
 * Returns a discriminated result rather than throwing, so both HTTP callers can
 * map failures onto their own status codes without a shared error-translation
 * layer. Genuine DB faults still throw and are caught by the caller's try/catch.
 */
export async function onboardEmployee(
  tx: Tx,
  input: OnboardInput,
  actorUserId: string,
): Promise<OnboardResult> {
  const name = input.name?.trim() ?? "";
  const department = input.department?.trim() ?? "";
  if (!name || !department || !(input.joiningDate instanceof Date))
    return {
      ok: false,
      code: "BAD_INPUT",
      message: "name, department and a valid joiningDate are required",
    };

  const employeeCode = input.employeeCode?.trim() || (await nextEmployeeCode(tx));

  const dupe = await tx.employee.findUnique({
    where: { employeeCode },
    select: { id: true },
  });
  if (dupe)
    return {
      ok: false,
      code: "DUPLICATE_CODE",
      message: `Employee code ${employeeCode} already exists`,
    };

  const email = input.email?.trim().toLowerCase() || null;
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return { ok: false, code: "BAD_INPUT", message: `"${email}" is not a valid email address` };
    const emailDupe = await tx.employee.findUnique({
      where: { email },
      select: { employeeCode: true },
    });
    if (emailDupe)
      return {
        ok: false,
        code: "DUPLICATE_EMAIL",
        message: `Email ${email} already belongs to employee ${emailDupe.employeeCode}`,
      };
  }

  const managerId = input.managerId?.trim() || null;
  if (managerId) {
    const mgr = await tx.employee.findFirst({
      where: { id: managerId, active: true },
      select: { id: true },
    });
    if (!mgr)
      return {
        ok: false,
        code: "BAD_MANAGER",
        message: "Selected manager is not an active employee",
      };
  }

  const emp = await tx.employee.create({
    data: {
      employeeCode,
      name,
      department,
      designation: input.designation?.trim() || null,
      managerId,
      machineId: input.machineId?.trim() || null,
      joiningDate: input.joiningDate,
      email,
    },
  });

  await tx.auditLog.create({
    data: { actorUserId, action: "EMPLOYEE_ONBOARDED", targetEntity: emp.id },
  });

  return {
    ok: true,
    employee: { id: emp.id, employeeCode: emp.employeeCode, name: emp.name },
  };
}

/**
 * The checklist every new joiner starts with. Deliberately a flat list of
 * strings — this is a checklist, not a workflow engine. HR ticks items off and
 * can add their own.
 */
export const DEFAULT_ONBOARDING_TASKS = [
  "Collect ID proof",
  "Collect address proof",
  "Issue equipment",
  "IT account setup",
  "Complete compliance consent forms",
  "Assign shift",
  "Collect PF UAN / bank details",
] as const;

/** Seed the default checklist. Safe to call once, at creation. */
export async function createDefaultOnboardingTasks(
  tx: Tx,
  employeeId: string,
): Promise<number> {
  const res = await tx.onboardingTask.createMany({
    data: DEFAULT_ONBOARDING_TASKS.map((taskName) => ({ employeeId, taskName })),
  });
  return res.count;
}
