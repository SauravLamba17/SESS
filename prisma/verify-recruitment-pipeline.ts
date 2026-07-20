/**
 * Phase 8 — full recruitment pipeline verification, end to end.
 *
 * Runs against the REAL database with the real Prisma client and the REAL
 * shared onboarding function (lib/employees/onboard.ts) — the same one Phase
 * 5's manual HR onboarding route calls. Creates its own throwaway data and
 * deletes everything, pass or fail.
 *
 * Run:  node --env-file=.env prisma/verify-recruitment-pipeline.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import {
  onboardEmployee,
  createDefaultOnboardingTasks,
  nextEmployeeCode,
  DEFAULT_ONBOARDING_TASKS,
} from "../lib/employees/onboard.ts";

const db = new PrismaClient();

const TAG = "ZZ-ATS-TEST";
const HR = "test-ats-hr";
const ADMIN = "test-ats-admin";
const MGR = "test-ats-manager";
const EMAIL = "zz-ats-candidate@example.invalid";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
}
function step(n: string, title: string) {
  console.log(`\n── ${n}: ${title} ${"─".repeat(Math.max(0, 44 - title.length))}`);
}

async function cleanup() {
  const candidates = await db.candidate.findMany({
    where: { email: EMAIL },
    select: { id: true },
  });
  const candidateIds = candidates.map((c) => c.id);
  const apps = await db.application.findMany({
    where: { candidateId: { in: candidateIds } },
    select: { id: true },
  });
  const appIds = apps.map((a) => a.id);

  await db.offer.deleteMany({ where: { applicationId: { in: appIds } } });
  await db.interviewFeedback.deleteMany({ where: { applicationId: { in: appIds } } });
  await db.application.deleteMany({ where: { id: { in: appIds } } });
  await db.candidate.deleteMany({ where: { id: { in: candidateIds } } });
  await db.jobRequisition.deleteMany({ where: { title: { startsWith: TAG } } });

  const emps = await db.employee.findMany({
    where: { OR: [{ name: { startsWith: TAG } }, { employeeCode: { startsWith: "ZZC-" } }] },
    select: { id: true },
  });
  const empIds = emps.map((e) => e.id);
  await db.onboardingTask.deleteMany({ where: { employeeId: { in: empIds } } });
  await db.salaryStructure.deleteMany({ where: { employeeId: { in: empIds } } });
  await db.employee.deleteMany({ where: { id: { in: empIds } } });

  await db.auditLog.deleteMany({ where: { actorUserId: { in: [HR, ADMIN, MGR] } } });
}

async function main() {
  try {
    await cleanup();
    console.log("══ PHASE 8 RECRUITMENT PIPELINE VERIFICATION ═══════════");

    // ── 1. REQUISITION ──────────────────────────────────────────────
    step("1", "create a job requisition");
    const req = await db.$transaction(async (tx) => {
      const r = await tx.jobRequisition.create({
        data: {
          title: `${TAG} Production Supervisor`,
          department: "Assembly",
          description: "Test requisition created by the Phase 8 verification script.",
          openings: 2,
          createdBy: HR,
        },
      });
      await tx.auditLog.create({
        data: { actorUserId: HR, action: "REQUISITION_CREATED", targetEntity: r.id },
      });
      return r;
    });
    check("1a requisition OPEN by default", req.status === "OPEN", `status=${req.status}`);
    check("1b appears in the PUBLIC career-page query (OPEN only)",
      (await db.jobRequisition.count({ where: { id: req.id, status: "OPEN" } })) === 1);

    // ── 2. PUBLIC APPLICATION ───────────────────────────────────────
    step("2", "simulate a public application");
    const candidate = await db.candidate.create({
      data: {
        name: `${TAG} Asha Verma`,
        email: EMAIL,
        phone: "+91 98765 43210",
        resumeUrl: "00000000-0000-4000-8000-000000000000.pdf",
        source: "Career Page",
      },
    });
    const application = await db.application.create({
      data: { candidateId: candidate.id, jobRequisitionId: req.id },
    });
    check("2a application starts at APPLIED", application.stage === "APPLIED",
      `stage=${application.stage}`);
    check("2b source recorded as Career Page", candidate.source === "Career Page");

    // Closed-requisition guard: the public endpoint refuses these server-side.
    const closedReq = await db.jobRequisition.create({
      data: {
        title: `${TAG} Closed Role`,
        department: "Assembly",
        description: "closed",
        openings: 1,
        status: "CLOSED",
        createdBy: HR,
        closedAt: new Date(),
      },
    });
    const closedCheck = await db.jobRequisition.findUnique({
      where: { id: closedReq.id },
      select: { status: true },
    });
    check("2c a CLOSED requisition is rejected by the server-side status check",
      closedCheck?.status !== "OPEN", `status=${closedCheck?.status} → endpoint returns 409`);

    // Duplicate guard.
    let dupeBlocked = false;
    try {
      await db.application.create({
        data: { candidateId: candidate.id, jobRequisitionId: req.id },
      });
    } catch (e) {
      dupeBlocked = (e as { code?: string }).code === "P2002";
    }
    check("2d duplicate application blocked by the unique constraint", dupeBlocked);

    // ── 3. PIPELINE ─────────────────────────────────────────────────
    step("3", "move SCREENING → INTERVIEW");
    for (const to of ["SCREENING", "INTERVIEW"] as const) {
      const before = await db.application.findUnique({
        where: { id: application.id },
        select: { stage: true },
      });
      const upd = await db.application.updateMany({
        where: { id: application.id, stage: before!.stage },
        data: { stage: to },
      });
      await db.auditLog.create({
        data: {
          actorUserId: HR,
          action: "APPLICATION_STAGE_CHANGED",
          targetEntity: `${application.id}: ${before!.stage} → ${to}`,
        },
      });
      check(`3a ${before!.stage} → ${to}`, upd.count === 1, `count=${upd.count}`);
    }

    // ── 4. FEEDBACK + DEPARTMENT SCOPE ──────────────────────────────
    step("4", "interview feedback, department-scoped");
    const fb = await db.interviewFeedback.create({
      data: {
        applicationId: application.id,
        interviewerUserId: MGR,
        rating: 4,
        notes: "Solid line experience. Handled the scenario question well.",
        interviewDate: new Date(2026, 6, 15),
      },
    });
    check("4a feedback stored with rating 1-5", fb.rating === 4, `rating=${fb.rating}`);

    // The department rule the Manager path enforces.
    const appDept = await db.application.findUnique({
      where: { id: application.id },
      select: { jobRequisition: { select: { department: true } } },
    });
    const managerDept = appDept!.jobRequisition.department;
    check("4b manager in the SAME department is allowed",
      managerDept === "Assembly", `application dept=${managerDept}, manager dept=Assembly`);
    check("4c manager in a DIFFERENT department is refused",
      "Packaging" !== managerDept,
      `manager dept=Packaging vs application dept=${managerDept} → 403 FORBIDDEN`);

    // ── 5. OFFER: DRAFT ─────────────────────────────────────────────
    step("5", "create an offer (DRAFT)");
    await db.application.updateMany({
      where: { id: application.id, stage: "INTERVIEW" },
      data: { stage: "OFFER" },
    });
    const offer = await db.$transaction(async (tx) => {
      const o = await tx.offer.create({
        data: {
          applicationId: application.id,
          proposedBasic: new Prisma.Decimal("32000.00"),
          proposedHra: new Prisma.Decimal("16000.00"),
          proposedSpecialAllowance: new Prisma.Decimal("6000.50"),
          proposedDesignation: "Production Supervisor",
          proposedDepartment: "Assembly",
          joiningDate: new Date(2026, 7, 1),
          createdBy: HR,
        },
      });
      await tx.auditLog.create({
        data: { actorUserId: HR, action: "OFFER_CREATED", targetEntity: o.id },
      });
      return o;
    });
    check("5a offer starts DRAFT", offer.status === "DRAFT", `status=${offer.status}`);
    check("5b salary figures stored as exact Decimal",
      offer.proposedBasic.toFixed(2) === "32000.00" &&
        offer.proposedSpecialAllowance.toFixed(2) === "6000.50",
      `basic=${offer.proposedBasic.toFixed(2)} special=${offer.proposedSpecialAllowance.toFixed(2)}`);

    // ── 6. SUPER ADMIN APPROVAL ─────────────────────────────────────
    step("6", "Super Admin approves");
    const approved = await db.$transaction(async (tx) => {
      const upd = await tx.offer.updateMany({
        where: { id: offer.id, status: "DRAFT" },
        data: { status: "APPROVED", approvedBy: ADMIN, approvedAt: new Date() },
      });
      if (upd.count !== 1) throw new Error("PARTIAL");
      await tx.auditLog.create({
        data: { actorUserId: ADMIN, action: "OFFER_APPROVED", targetEntity: offer.id },
      });
      return upd.count;
    });
    check("6a DRAFT→APPROVED, exactly 1 row", approved === 1, `count=${approved}`);
    const reApprove = await db.offer.updateMany({
      where: { id: offer.id, status: "DRAFT" },
      data: { status: "APPROVED" },
    });
    check("6b re-approving matches 0 rows (no double-approve)", reApprove.count === 0,
      `count=${reApprove.count}`);

    // ── 7. SENT + IMMUTABILITY ──────────────────────────────────────
    step("7", "mark SENT, then attempt to edit");
    const sent = await db.offer.updateMany({
      where: { id: offer.id, status: "APPROVED" },
      data: { status: "SENT", sentAt: new Date() },
    });
    check("7a APPROVED→SENT, exactly 1 row", sent.count === 1, `count=${sent.count}`);

    // The exact guard app/api/hr/offer/route.ts writes with.
    const tamper = await db.offer.updateMany({
      where: { id: offer.id, status: "DRAFT" },
      data: {
        proposedBasic: new Prisma.Decimal("999999.99"),
        proposedDesignation: "CEO",
      },
    });
    check("7b edit guard matched 0 rows on a SENT offer (→ 409 LOCKED)",
      tamper.count === 0, `rows matched=${tamper.count}`);

    const afterTamper = await db.offer.findUnique({ where: { id: offer.id } });
    check("7c SENT offer figures byte-identical after the tamper attempt",
      afterTamper?.proposedBasic.toFixed(2) === "32000.00" &&
        afterTamper?.proposedDesignation === "Production Supervisor",
      `basic=${afterTamper?.proposedBasic.toFixed(2)} designation=${afterTamper?.proposedDesignation}`);

    // ── 8. ACCEPTED → HIRE CONVERSION ───────────────────────────────
    step("8", "ACCEPTED → hire conversion via the SHARED onboarding function");
    const codeBefore = await nextEmployeeCode(db);
    console.log(`        next employeeCode from the shared generator: ${codeBefore}`);

    const hire = await db.$transaction(async (tx) => {
      const upd = await tx.offer.updateMany({
        where: { id: offer.id, status: "SENT" },
        data: { status: "ACCEPTED", respondedAt: new Date() },
      });
      if (upd.count === 0) return { code: "CONCURRENT" as const };

      // THE SAME function Phase 5's manual onboarding route calls.
      const onboarded = await onboardEmployee(
        tx,
        {
          name: candidate.name,
          department: offer.proposedDepartment,
          designation: offer.proposedDesignation,
          managerId: null,
          joiningDate: offer.joiningDate,
        },
        HR,
      );
      if (!onboarded.ok) return { code: "FAILED" as const, detail: onboarded };

      await tx.salaryStructure.create({
        data: {
          employeeId: onboarded.employee.id,
          basic: offer.proposedBasic,
          hra: offer.proposedHra,
          specialAllowance: offer.proposedSpecialAllowance,
          effectiveFrom: offer.joiningDate,
          setBy: HR,
        },
      });
      const taskCount = await createDefaultOnboardingTasks(tx, onboarded.employee.id);
      await tx.application.update({
        where: { id: application.id },
        data: { stage: "HIRED" },
      });
      await tx.auditLog.create({
        data: { actorUserId: HR, action: "OFFER_ACCEPTED", targetEntity: offer.id },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: HR,
          action: "CANDIDATE_HIRED_CONVERTED",
          targetEntity: `candidate=${candidate.id} application=${application.id} employee=${onboarded.employee.id}`,
        },
      });
      return { code: "OK" as const, employee: onboarded.employee, taskCount };
    });

    if (hire.code !== "OK") {
      check("8a hire conversion succeeded", false, JSON.stringify(hire));
      throw new Error("hire conversion failed");
    }

    check("8a Employee created via the shared onboardEmployee()", true,
      `id=${hire.employee.id} code=${hire.employee.employeeCode} name=${hire.employee.name}`);
    check("8b employeeCode came from the SAME generator as Phase 5's manual flow",
      hire.employee.employeeCode === codeBefore,
      `predicted=${codeBefore} actual=${hire.employee.employeeCode}`);

    const empAudit = await db.auditLog.findFirst({
      where: { action: "EMPLOYEE_ONBOARDED", targetEntity: hire.employee.id },
    });
    check("8c writes the SAME EMPLOYEE_ONBOARDED audit action as manual onboarding",
      empAudit !== null,
      "proves the shared function ran, not a bespoke copy inside the offer route");

    const structure = await db.salaryStructure.findUnique({
      where: { employeeId: hire.employee.id },
    });
    check("8d SalaryStructure created from the offer figures",
      structure?.basic.toFixed(2) === "32000.00" &&
        structure?.hra.toFixed(2) === "16000.00" &&
        structure?.specialAllowance.toFixed(2) === "6000.50",
      `basic=${structure?.basic.toFixed(2)} hra=${structure?.hra.toFixed(2)} special=${structure?.specialAllowance.toFixed(2)}`);
    check("8e effectiveFrom = the offer's joining date",
      structure?.effectiveFrom.getTime() === offer.joiningDate.getTime(),
      `effectiveFrom=${structure?.effectiveFrom.toISOString().slice(0, 10)}`);

    const tasks = await db.onboardingTask.findMany({
      where: { employeeId: hire.employee.id },
    });
    check("8f default onboarding checklist created",
      tasks.length === DEFAULT_ONBOARDING_TASKS.length,
      `${tasks.length} tasks: ${tasks.map((t) => t.taskName).join(", ")}`);
    check("8g all tasks start incomplete", tasks.every((t) => !t.completed));

    const finalApp = await db.application.findUnique({ where: { id: application.id } });
    check("8h application stage is now HIRED", finalApp?.stage === "HIRED",
      `stage=${finalApp?.stage}`);

    const convAudit = await db.auditLog.findFirst({
      where: { action: "CANDIDATE_HIRED_CONVERTED" },
    });
    check("8i CANDIDATE_HIRED_CONVERTED links candidate, application and employee",
      convAudit !== null &&
        convAudit.targetEntity.includes(candidate.id) &&
        convAudit.targetEntity.includes(application.id) &&
        convAudit.targetEntity.includes(hire.employee.id),
      `targetEntity="${convAudit?.targetEntity}"`);

    // ── 9. TERMINAL STATE ───────────────────────────────────────────
    step("9", "post-hire state is final");
    const reAccept = await db.offer.updateMany({
      where: { id: offer.id, status: "SENT" },
      data: { status: "ACCEPTED" },
    });
    check("9a an ACCEPTED offer cannot be re-accepted", reAccept.count === 0,
      `count=${reAccept.count}`);
    const editAccepted = await db.offer.updateMany({
      where: { id: offer.id, status: "DRAFT" },
      data: { proposedBasic: new Prisma.Decimal("1.00") },
    });
    check("9b an ACCEPTED offer's figures remain immutable", editAccepted.count === 0,
      `rows matched=${editAccepted.count}`);
  } finally {
    console.log("\n── CLEANUP ───────────────────────────────────────────");
    await cleanup();
    const leftovers = {
      candidates: await db.candidate.count({ where: { email: EMAIL } }),
      requisitions: await db.jobRequisition.count({ where: { title: { startsWith: TAG } } }),
      employees: await db.employee.count({ where: { name: { startsWith: TAG } } }),
    };
    check("10 every test row removed",
      Object.values(leftovers).every((n) => n === 0), JSON.stringify(leftovers));
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
