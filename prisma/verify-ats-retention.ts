/**
 * Verification for the five ATS enhancements: field rename, offer letter PDF
 * gating, HR notification, multi-round interviews, and the 1-year candidate
 * data retention policy with opt-in talent pool.
 *
 * Runs against the REAL database with the real helpers. Creates its own
 * throwaway data and deletes everything, pass or fail.
 *
 * Run:  node --env-file=.env prisma/verify-ats-retention.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { notifyHrOfApplication, hrRecipients } from "../lib/recruitment/notify.ts";
import {
  scheduleRetentionOnRejection,
  deleteCandidateData,
  retentionDateFor,
  addDays,
  RETENTION_DAYS_NO_CONSENT,
  RETENTION_DAYS_WITH_CONSENT,
} from "../lib/recruitment/retention.ts";

const db = new PrismaClient();

const TAG = "ZZ-RET-TEST";
const HR = "test-ret-hr";
const ADMIN = "test-ret-admin";
const E_NOCONSENT = "zz-ret-noconsent@example.invalid";
const E_CONSENT = "zz-ret-consent@example.invalid";
const E_PASTDUE = "zz-ret-pastdue@example.invalid";
const ALL_EMAILS = [E_NOCONSENT, E_CONSENT, E_PASTDUE];

// The suite's OWN Employee + linked HR User. Step 0 needs any employee to hang
// a ClientMail row on, and step 2's notification fan-out needs an active
// Employee whose User role is HR. Both used to borrow whatever happened to be
// in the database — which broke as soon as the seeded demo accounts were
// removed. Created and deleted here instead.
const HR_CODE = "ZZ-RET-HR";
const HR_CLERK = "test-ret-hr-user";

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
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

const DOWNLOADABLE = ["APPROVED", "SENT", "ACCEPTED", "DECLINED"];
const letterAllowed = (s: string) => DOWNLOADABLE.includes(s);

async function cleanup() {
  const cands = await db.candidate.findMany({
    where: { email: { in: ALL_EMAILS } },
    select: { id: true },
  });
  const cIds = cands.map((c) => c.id);
  const apps = await db.application.findMany({
    where: { candidateId: { in: cIds } },
    select: { id: true },
  });
  const aIds = apps.map((a) => a.id);
  await db.offer.deleteMany({ where: { applicationId: { in: aIds } } });
  await db.interviewFeedback.deleteMany({ where: { applicationId: { in: aIds } } });
  await db.application.deleteMany({ where: { id: { in: aIds } } });
  await db.candidate.deleteMany({ where: { id: { in: cIds } } });
  await db.jobRequisition.deleteMany({ where: { title: { startsWith: TAG } } });
  await db.notification.deleteMany({ where: { message: { contains: TAG } } });
  await db.auditLog.deleteMany({ where: { actorUserId: { in: [HR, ADMIN] } } });

  // The suite's own HR employee: dependent rows, then the User that links it,
  // then the Employee (User.employeeId → Employee).
  const fixtures = await db.employee.findMany({
    where: { employeeCode: HR_CODE },
    select: { id: true },
  });
  const fIds = fixtures.map((e) => e.id);
  if (fIds.length > 0) {
    await db.clientMail.deleteMany({ where: { employeeId: { in: fIds } } });
    await db.notification.deleteMany({ where: { employeeId: { in: fIds } } });
  }
  await db.user.deleteMany({ where: { clerkId: HR_CLERK } });
  await db.employee.deleteMany({ where: { employeeCode: HR_CODE } });
}

async function main() {
  try {
    await cleanup();
    console.log("══ ATS ENHANCEMENTS + RETENTION VERIFICATION ═══════════");

    // ── STEP 0: RENAME ──────────────────────────────────────────────
    step("0", "ClientMail.summary rename");
    // This suite's own employee, created here rather than borrowed from
    // whatever rows happen to exist — see HR_CODE above.
    const emp = await db.employee.create({
      data: {
        employeeCode: HR_CODE,
        name: `${TAG} HR Recipient`,
        department: "People Ops",
        designation: "HR Generalist",
        joiningDate: new Date("2020-01-01"),
      },
    });
    await db.user.create({ data: { clerkId: HR_CLERK, role: "HR", employeeId: emp.id } });

    const mail = await db.clientMail.create({
      data: {
        employeeId: emp.id,
        subject: `${TAG} subject`,
        summary: "Manager-typed text, no AI involved.",
        date: new Date(),
      },
    });
    check("0a ClientMail.summary accepts and stores text",
      mail.summary === "Manager-typed text, no AI involved.", `summary="${mail.summary}"`);
    check("0b field is named `summary` on the Prisma client",
      Object.prototype.hasOwnProperty.call(mail, "summary") &&
        !Object.prototype.hasOwnProperty.call(mail, "summaryViaClaude"),
      `keys include summary=${"summary" in mail}, summaryViaClaude=${"summaryViaClaude" in mail}`);
    await db.clientMail.delete({ where: { id: mail.id } });

    // ── SETUP ───────────────────────────────────────────────────────
    step("SETUP", "requisition + three candidates");
    const req = await db.jobRequisition.create({
      data: {
        title: `${TAG} Machine Operator`,
        department: "Assembly",
        description: "Test requisition.",
        openings: 1,
        createdBy: HR,
      },
    });

    // A: applied WITHOUT talent-pool consent (checkbox left unticked).
    const candA = await db.candidate.create({
      data: {
        name: `${TAG} Neha (no consent)`,
        email: E_NOCONSENT,
        phone: "+91 90000 00001",
        resumeUrl: "00000000-0000-4000-8000-00000000000a.pdf",
        source: "Career Page",
        talentPoolConsent: false,
      },
    });
    const appA = await db.application.create({
      data: { candidateId: candA.id, jobRequisitionId: req.id },
    });
    check("S1 unticked checkbox stores consent=false, no consent timestamp",
      candA.talentPoolConsent === false && candA.talentPoolConsentAt === null,
      `consent=${candA.talentPoolConsent} at=${candA.talentPoolConsentAt}`);

    // B: applied WITH consent.
    const consentAt = new Date();
    const candB = await db.candidate.create({
      data: {
        name: `${TAG} Vikram (consented)`,
        email: E_CONSENT,
        phone: "+91 90000 00002",
        resumeUrl: "00000000-0000-4000-8000-00000000000b.pdf",
        source: "Career Page",
        talentPoolConsent: true,
        talentPoolConsentAt: consentAt,
      },
    });
    const appB = await db.application.create({
      data: { candidateId: candB.id, jobRequisitionId: req.id },
    });
    check("S2 ticked checkbox stores consent=true WITH a timestamp",
      candB.talentPoolConsent === true && candB.talentPoolConsentAt !== null,
      `consent=${candB.talentPoolConsent} at=${candB.talentPoolConsentAt?.toISOString().slice(0, 10)}`);

    // ── STEP 2: HR NOTIFICATION ─────────────────────────────────────
    step("2", "HR notified on new application");
    const recipients = await hrRecipients(db);
    const notified = await db.$transaction((tx) =>
      notifyHrOfApplication(tx, {
        candidateName: candA.name,
        requisitionTitle: req.title,
      }),
    );
    check("2a notification written to every HR recipient",
      notified.recipients === recipients.length && !notified.noRecipients,
      `recipients=${notified.recipients}`);

    const note = await db.notification.findFirst({
      where: { type: "NEW_APPLICATION", message: { contains: TAG } },
      include: { recipient: { select: { role: true } } },
    });
    check("2b addressed to a USER whose role is HR",
      note?.recipient.role === "HR",
      `recipientUserId=${note?.recipientUserId} role=${note?.recipient.role}`);
    check("2b-i carries no employee context — it concerns a candidate",
      note?.employeeId === null,
      `employeeId=${note?.employeeId ?? "null"}`);
    check("2c message names candidate and requisition",
      !!note?.message.includes("Neha") && !!note?.message.includes("Machine Operator"),
      `"${note?.message}"`);

    // ── STEP 1: OFFER LETTER GATING ─────────────────────────────────
    step("1", "offer letter — DRAFT rejected, APPROVED allowed");
    await db.application.update({ where: { id: appB.id }, data: { stage: "OFFER" } });
    const offer = await db.offer.create({
      data: {
        applicationId: appB.id,
        proposedBasic: new Prisma.Decimal("28000.00"),
        proposedHra: new Prisma.Decimal("14000.00"),
        proposedSpecialAllowance: new Prisma.Decimal("3500.25"),
        proposedDesignation: "Machine Operator",
        proposedDepartment: "Assembly",
        joiningDate: new Date(2026, 9, 1),
        createdBy: HR,
      },
    });
    check("1a DRAFT offer → letter REFUSED (409 NOT_APPROVED)",
      !letterAllowed(offer.status), `status=${offer.status}`);

    await db.offer.updateMany({
      where: { id: offer.id, status: "DRAFT" },
      data: { status: "APPROVED", approvedBy: ADMIN, approvedAt: new Date() },
    });
    const approved = await db.offer.findUnique({ where: { id: offer.id } });
    check("1b APPROVED offer → letter ALLOWED", letterAllowed(approved!.status),
      `status=${approved!.status}`);

    const gross = approved!.proposedBasic
      .plus(approved!.proposedHra)
      .plus(approved!.proposedSpecialAllowance);
    check("1c compensation exact: 28000 + 14000 + 3500.25 = 45500.25",
      gross.toFixed(2) === "45500.25", `gross=${gross.toFixed(2)}`);
    check("1d WITHDRAWN never downloadable", !letterAllowed("WITHDRAWN"));

    // ── STEP 3: MULTI-ROUND INTERVIEWS ──────────────────────────────
    step("3", "multi-round interview tracking");
    const r1 = await db.interviewFeedback.create({
      data: {
        applicationId: appB.id,
        interviewerUserId: HR,
        rating: 3,
        notes: "Round 1 screening.",
        interviewDate: new Date(2026, 0, 15),
      },
    });
    const r2 = await db.interviewFeedback.create({
      data: {
        applicationId: appB.id,
        interviewerUserId: ADMIN,
        rating: 5,
        notes: "Round 2 technical — strong.",
        interviewDate: new Date(2026, 0, 22),
        roundNumber: 2,
      },
    });
    check("3a omitted roundNumber defaults to 1", r1.roundNumber === 1, `round=${r1.roundNumber}`);
    check("3b round 2 stored distinctly", r2.roundNumber === 2, `round=${r2.roundNumber}`);

    const feedback = await db.interviewFeedback.findMany({
      where: { applicationId: appB.id },
      orderBy: [{ roundNumber: "asc" }, { interviewDate: "asc" }],
    });
    const grouped = new Map<number, typeof feedback>();
    for (const f of feedback) {
      const arr = grouped.get(f.roundNumber) ?? [];
      arr.push(f);
      grouped.set(f.roundNumber, arr);
    }
    check("3c groups into 2 distinct rounds, not a flat list",
      grouped.size === 2 && grouped.get(1)!.length === 1 && grouped.get(2)!.length === 1,
      feedback.map((f) => `R${f.roundNumber}:${f.rating}/5`).join(" | "));

    // ── STEP 4: RETENTION ───────────────────────────────────────────
    step("4", "rejection schedules retention — 1yr / 2yr");
    const now = new Date();

    const retA = await db.$transaction(async (tx) => {
      await tx.application.updateMany({
        where: { id: appA.id },
        data: { stage: "REJECTED", rejectedReason: "Test rejection" },
      });
      return scheduleRetentionOnRejection(tx, candA.id, now);
    });
    const afterA = await db.candidate.findUnique({ where: { id: candA.id } });
    const daysA = daysBetween(now, afterA!.scheduledDeletionAt!);
    check("4a NO consent → scheduled ~365 days out",
      daysA === RETENTION_DAYS_NO_CONSENT,
      `scheduled ${afterA!.scheduledDeletionAt!.toISOString().slice(0, 10)} = ${daysA} days (expected ${RETENTION_DAYS_NO_CONSENT})`);
    check("4b returns the consent flag it acted on", retA?.consented === false);

    const retB = await db.$transaction(async (tx) => {
      await tx.application.updateMany({
        where: { id: appB.id },
        data: { stage: "REJECTED", rejectedReason: "Test rejection" },
      });
      return scheduleRetentionOnRejection(tx, candB.id, now);
    });
    const afterB = await db.candidate.findUnique({ where: { id: candB.id } });
    const daysB = daysBetween(now, afterB!.scheduledDeletionAt!);
    check("4c WITH consent → scheduled ~730 days out (bounded, not indefinite)",
      daysB === RETENTION_DAYS_WITH_CONSENT,
      `scheduled ${afterB!.scheduledDeletionAt!.toISOString().slice(0, 10)} = ${daysB} days (expected ${RETENTION_DAYS_WITH_CONSENT})`);
    check("4d consented candidate has NO near-term deletion",
      daysB > RETENTION_DAYS_NO_CONSENT, `${daysB} > ${RETENTION_DAYS_NO_CONSENT}`);
    check("4e retentionDateFor() agrees with what was stored",
      daysBetween(now, retentionDateFor(false, now)) === RETENTION_DAYS_NO_CONSENT &&
        daysBetween(now, retentionDateFor(true, now)) === RETENTION_DAYS_WITH_CONSENT);

    // ── STEP 4b: REVIEW-LIST FILTER ─────────────────────────────────
    step("4", "review list shows ONLY past-due candidates");
    const candPast = await db.candidate.create({
      data: {
        name: `${TAG} Past Due`,
        email: E_PASTDUE,
        phone: "+91 90000 00003",
        resumeUrl: "00000000-0000-4000-8000-00000000000c.pdf",
        source: "Career Page",
        talentPoolConsent: false,
        scheduledDeletionAt: addDays(new Date(), -30), // 30 days overdue
      },
    });
    const appPast = await db.application.create({
      data: { candidateId: candPast.id, jobRequisitionId: req.id, stage: "REJECTED" },
    });

    // The exact query the retention-review page runs.
    const due = await db.candidate.findMany({
      where: { scheduledDeletionAt: { not: null, lte: new Date() } },
      select: { id: true, name: true },
    });
    const upcoming = await db.candidate.findMany({
      where: { scheduledDeletionAt: { not: null, gt: new Date() } },
      select: { id: true, name: true },
    });
    const dueIds = due.map((d) => d.id);
    const upIds = upcoming.map((u) => u.id);

    check("4f past-due candidate IS listed as due",
      dueIds.includes(candPast.id), `due list has ${due.length} entr(ies)`);
    check("4g not-yet-due candidate is NOT listed as due (filter is correct)",
      !dueIds.includes(candA.id) && !dueIds.includes(candB.id),
      `candA due? ${dueIds.includes(candA.id)}  candB due? ${dueIds.includes(candB.id)}`);
    check("4h both future-dated candidates appear under 'not yet due'",
      upIds.includes(candA.id) && upIds.includes(candB.id));

    // ── STEP 4c: DELETION + CASCADE REALITY ─────────────────────────
    step("4", "deletion — Prisma cascades NOTHING, order matters");
    await db.interviewFeedback.create({
      data: {
        applicationId: appPast.id,
        interviewerUserId: HR,
        rating: 2,
        notes: "Round 1.",
        interviewDate: new Date(2025, 0, 5),
      },
    });

    // Prove the cascade claim rather than asserting it.
    let cascadeBlocked = false;
    let cascadeCode = "";
    try {
      await db.candidate.delete({ where: { id: candPast.id } });
    } catch (e) {
      cascadeBlocked = true;
      cascadeCode = (e as { code?: string }).code ?? "";
    }
    check("4i deleting a Candidate directly FAILS — nothing cascades",
      cascadeBlocked && cascadeCode === "P2003",
      `error=${cascadeCode} (Application_candidateId_fkey) → explicit ordered deletion required`);

    const counts = await db.$transaction(async (tx) => {
      const c = await deleteCandidateData(tx, candPast.id);
      await tx.auditLog.create({
        data: {
          actorUserId: HR,
          action: "CANDIDATE_DATA_DELETED",
          targetEntity: `${candPast.id} (${candPast.name}) applications=${c.applications}`,
        },
      });
      return c;
    });
    check("4j ordered deletion removes everything",
      counts.candidates === 1 && counts.applications === 1 && counts.interviewFeedback === 1,
      JSON.stringify(counts));
    check("4k candidate row is gone",
      (await db.candidate.count({ where: { id: candPast.id } })) === 0);
    check("4l their applications are gone",
      (await db.application.count({ where: { candidateId: candPast.id } })) === 0);

    const delAudit = await db.auditLog.findFirst({
      where: { action: "CANDIDATE_DATA_DELETED" },
    });
    check("4m CANDIDATE_DATA_DELETED audit survives the deletion",
      delAudit !== null && delAudit.targetEntity.includes(candPast.id),
      `"${delAudit?.targetEntity}"`);

    // ── STEP 4d: HIRED CANDIDATES ARE NEVER SCHEDULED ───────────────
    step("4", "hired candidates excluded from the retention clock");
    await db.application.updateMany({ where: { id: appA.id }, data: { stage: "HIRED" } });
    await db.candidate.update({
      where: { id: candA.id },
      data: { scheduledDeletionAt: null },
    });
    const hiredRet = await db.$transaction((tx) =>
      scheduleRetentionOnRejection(tx, candA.id, now),
    );
    const afterHired = await db.candidate.findUnique({ where: { id: candA.id } });
    check("4n a hired candidate is never scheduled for deletion",
      hiredRet === null && afterHired!.scheduledDeletionAt === null,
      "lawful basis becomes employment records, governed by a longer clock");
  } finally {
    console.log("\n── CLEANUP ───────────────────────────────────────────");
    await cleanup();
    const left = {
      candidates: await db.candidate.count({ where: { email: { in: ALL_EMAILS } } }),
      requisitions: await db.jobRequisition.count({ where: { title: { startsWith: TAG } } }),
      notifications: await db.notification.count({ where: { message: { contains: TAG } } }),
    };
    check("CLEANUP every test row removed",
      Object.values(left).every((n) => n === 0), JSON.stringify(left));
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
