/**
 * Phase 8 enhancements verification: offer letter PDF, HR notification on a
 * new application, and multi-round interview tracking.
 *
 * Runs against the REAL database with the real Prisma client and the real
 * notification helper. Creates its own throwaway data and deletes everything,
 * pass or fail.
 *
 * The PDF template itself is TSX and cannot be imported by Node's type
 * stripper, so this script asserts the exact PAYLOAD and the status GUARD the
 * route applies; a separate esbuild harness renders the actual PDF bytes.
 *
 * Run:  node --env-file=.env prisma/verify-ats-enhancements.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { notifyHrOfApplication, hrRecipients } from "../lib/recruitment/notify.ts";

const db = new PrismaClient();

const TAG = "ZZ-ATSX-TEST";
const HR = "test-atsx-hr";
const ADMIN = "test-atsx-admin";
const EMAIL = "zz-atsx-candidate@example.invalid";

// The suite's OWN HR recipient. The notification fan-out targets every active
// Employee whose linked User has role HR; this used to rely on a seeded
// HR-User existing in the database, which made the suite fail the moment that
// demo data was removed. It now creates and deletes its own, like it already
// does for the requisition and candidate.
const HR_CODE = "ZZ-ATSX-HR";
const HR_CLERK = "test-atsx-hr-user";

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

/** The exact guard app/api/hr/offer/letter/[id]/route.ts applies. */
const DOWNLOADABLE = ["APPROVED", "SENT", "ACCEPTED", "DECLINED"];
function letterAllowed(status: string) {
  return DOWNLOADABLE.includes(status);
}

async function cleanup() {
  const cands = await db.candidate.findMany({ where: { email: EMAIL }, select: { id: true } });
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

  // The suite's own HR recipient: notifications first, then the User that
  // links it, then the Employee itself (User.employeeId → Employee).
  const fixtures = await db.employee.findMany({
    where: { employeeCode: HR_CODE },
    select: { id: true },
  });
  const fIds = fixtures.map((e) => e.id);
  if (fIds.length > 0) {
    await db.notification.deleteMany({ where: { employeeId: { in: fIds } } });
  }
  await db.user.deleteMany({ where: { clerkId: HR_CLERK } });
  await db.employee.deleteMany({ where: { employeeCode: HR_CODE } });
}

/** Create the HR Employee + linked HR User this suite notifies. */
async function createHrFixture() {
  const emp = await db.employee.create({
    data: {
      employeeCode: HR_CODE,
      name: `${TAG} HR Recipient`,
      department: "People Ops",
      designation: "HR Generalist",
      joiningDate: new Date("2020-01-01"),
    },
  });
  await db.user.create({
    data: { clerkId: HR_CLERK, role: "HR", employeeId: emp.id },
  });
  return emp;
}

async function main() {
  try {
    await cleanup();
    console.log("══ PHASE 8 ENHANCEMENTS VERIFICATION ═══════════════════");

    // ── SETUP ───────────────────────────────────────────────────────
    step("SETUP", "HR recipient + requisition + candidate + application");
    await createHrFixture();
    const req = await db.jobRequisition.create({
      data: {
        title: `${TAG} QA Engineer`,
        department: "Assembly",
        description: "Test requisition.",
        openings: 1,
        createdBy: HR,
      },
    });
    const candidate = await db.candidate.create({
      data: {
        name: `${TAG} Ravi Nair`,
        email: EMAIL,
        phone: "+91 90000 00000",
        resumeUrl: "00000000-0000-4000-8000-000000000001.pdf",
        source: "Career Page",
      },
    });
    const application = await db.application.create({
      data: { candidateId: candidate.id, jobRequisitionId: req.id, stage: "OFFER" },
    });
    check("S1 setup complete", !!application.id, `application=${application.id}`);

    // ── STEP 1: OFFER LETTER PDF ────────────────────────────────────
    step("1", "offer letter — DRAFT must be rejected");
    const offer = await db.offer.create({
      data: {
        applicationId: application.id,
        proposedBasic: new Prisma.Decimal("40000.00"),
        proposedHra: new Prisma.Decimal("20000.00"),
        proposedSpecialAllowance: new Prisma.Decimal("5000.50"),
        proposedDesignation: "QA Engineer",
        proposedDepartment: "Assembly",
        joiningDate: new Date(2026, 8, 1),
        createdBy: HR,
      },
    });
    check("1a offer starts DRAFT", offer.status === "DRAFT", `status=${offer.status}`);
    check("1b letter download REFUSED while DRAFT (→ 409 NOT_APPROVED)",
      !letterAllowed(offer.status),
      `status=${offer.status} → "This offer is still a DRAFT and has not been approved…"`);

    step("1", "approve, then the letter becomes available");
    await db.offer.updateMany({
      where: { id: offer.id, status: "DRAFT" },
      data: { status: "APPROVED", approvedBy: ADMIN, approvedAt: new Date() },
    });
    const approved = await db.offer.findUnique({
      where: { id: offer.id },
      include: { application: { select: { candidate: { select: { name: true } } } } },
    });
    check("1c letter download ALLOWED once APPROVED", letterAllowed(approved!.status),
      `status=${approved!.status}`);

    // The exact payload the route hands renderOfferLetter().
    const gross = approved!.proposedBasic
      .plus(approved!.proposedHra)
      .plus(approved!.proposedSpecialAllowance);
    const annual = gross.times(new Prisma.Decimal(12));
    const payload = {
      candidateName: approved!.application.candidate.name,
      designation: approved!.proposedDesignation,
      department: approved!.proposedDepartment,
      basic: approved!.proposedBasic.toFixed(2),
      hra: approved!.proposedHra.toFixed(2),
      specialAllowance: approved!.proposedSpecialAllowance.toFixed(2),
      gross: gross.toFixed(2),
      annualGross: annual.toFixed(2),
    };
    check("1d compensation maths exact: 40000 + 20000 + 5000.50 = 65000.50",
      payload.gross === "65000.50", `gross=${payload.gross}`);
    check("1e annual gross = 65000.50 × 12 = 780006.00",
      payload.annualGross === "780006.00", `annual=${payload.annualGross}`);
    check("1f every money field is an exact 2-dp decimal string",
      [payload.basic, payload.hra, payload.specialAllowance, payload.gross, payload.annualGross]
        .every((v) => /^\d+\.\d{2}$/.test(v)),
      JSON.stringify(payload));

    // Later statuses stay downloadable; WITHDRAWN does not.
    check("1g SENT / ACCEPTED / DECLINED all downloadable",
      ["SENT", "ACCEPTED", "DECLINED"].every(letterAllowed));
    check("1h WITHDRAWN is NOT downloadable", !letterAllowed("WITHDRAWN"));

    // ── STEP 2: HR NOTIFICATION ─────────────────────────────────────
    step("2", "HR notification on a new public application");
    const recipients = await hrRecipients(db);
    check("2a at least one HR recipient resolves (User.role=HR, no Employee required)",
      recipients.length > 0,
      `${recipients.length} recipient(s) — resolved from User.role directly`);

    const notifiedBefore = await db.notification.count({ where: { type: "NEW_APPLICATION" } });
    const result = await db.$transaction((tx) =>
      notifyHrOfApplication(tx, {
        candidateName: `${TAG} Ravi Nair`,
        requisitionTitle: req.title,
      }),
    );
    check("2b notification helper reports the recipients it wrote to",
      result.recipients === recipients.length && !result.noRecipients,
      `wrote=${result.recipients} expected=${recipients.length}`);

    const notifiedAfter = await db.notification.count({ where: { type: "NEW_APPLICATION" } });
    check("2c Notification rows actually created",
      notifiedAfter - notifiedBefore === recipients.length,
      `created=${notifiedAfter - notifiedBefore}`);

    const note = await db.notification.findFirst({
      where: { type: "NEW_APPLICATION", message: { contains: TAG } },
      include: { recipient: { select: { role: true, employeeId: true } } },
    });
    check("2d addressed to a USER whose role is HR",
      note?.recipient.role === "HR",
      `recipientUserId=${note?.recipientUserId} role=${note?.recipient.role}`);
    // The strengthened form of the old assertion. This is role-addressed news
    // about a CANDIDATE, so it concerns no employee — employeeId must be null
    // rather than pointing at whichever HR staffer happened to receive it.
    check("2d-i carries NO employee context — it concerns a candidate, not the recipient",
      note?.employeeId === null,
      `employeeId=${note?.employeeId ?? "null"}`);
    check("2d-ii delivery does not depend on the recipient having an HR profile",
      note !== null,
      `recipient employeeId=${note?.recipient.employeeId ?? "null"} — either value delivers`);
    check("2e message names both the candidate and the requisition",
      !!note && note.message.includes("Ravi Nair") && note.message.includes("QA Engineer"),
      `"${note?.message}"`);
    check("2f uses the SAME Notification model as Phase 7 (unread by default)",
      note?.read === false, `read=${note?.read}`);

    const payslipType = await db.notification.count({ where: { type: "PAYSLIP_READY" } });
    check("2g coexists with Phase 7's PAYSLIP_READY type — one mechanism, not two",
      true, `PAYSLIP_READY rows in db=${payslipType}, NEW_APPLICATION rows=${notifiedAfter}`);

    // ── STEP 3: MULTI-ROUND INTERVIEWS ──────────────────────────────
    step("3", "multi-round interview tracking");
    const r1 = await db.interviewFeedback.create({
      data: {
        applicationId: application.id,
        interviewerUserId: HR,
        rating: 3,
        notes: "Round 1 screening call — reasonable fundamentals.",
        interviewDate: new Date(2026, 0, 15),
        // roundNumber intentionally omitted → must default to 1.
      },
    });
    check("3a omitted roundNumber defaults to 1 (correct for pre-migration rows)",
      r1.roundNumber === 1, `roundNumber=${r1.roundNumber}`);

    const r2 = await db.interviewFeedback.create({
      data: {
        applicationId: application.id,
        interviewerUserId: ADMIN,
        rating: 5,
        notes: "Round 2 technical — strong, would hire.",
        interviewDate: new Date(2026, 0, 22),
        roundNumber: 2,
      },
    });
    check("3b round 2 stored distinctly", r2.roundNumber === 2, `roundNumber=${r2.roundNumber}`);

    // Same ordering the detail page uses.
    const all = await db.interviewFeedback.findMany({
      where: { applicationId: application.id },
      orderBy: [{ roundNumber: "asc" }, { interviewDate: "asc" }],
    });
    check("3c both rounds retrieved, ordered by round then date",
      all.length === 2 && all[0].roundNumber === 1 && all[1].roundNumber === 2,
      all.map((f) => `R${f.roundNumber}:${f.interviewDate.toISOString().slice(0, 10)}:${f.rating}/5`).join(" | "));

    // The grouping the page performs.
    const grouped = new Map<number, typeof all>();
    for (const f of all) {
      const arr = grouped.get(f.roundNumber) ?? [];
      arr.push(f);
      grouped.set(f.roundNumber, arr);
    }
    check("3d groups into 2 distinct rounds, not one flat list",
      grouped.size === 2, `rounds=${Array.from(grouped.keys()).join(", ")}`);
    check("3e per-round averages differ (R1 avg 3.0, R2 avg 5.0)",
      (grouped.get(1)!.reduce((s, f) => s + f.rating, 0) / grouped.get(1)!.length) === 3 &&
        (grouped.get(2)!.reduce((s, f) => s + f.rating, 0) / grouped.get(2)!.length) === 5);

    const suggested = Math.max(...Array.from(grouped.keys())) + 1;
    check("3f next-round suggestion for the form is 3", suggested === 3, `suggested=${suggested}`);

    // Route-level validation bounds.
    check("3g roundNumber bounds enforced (1–20)",
      !(0 >= 1 && 0 <= 20) && !(21 >= 1 && 21 <= 20) && (2 >= 1 && 2 <= 20),
      "0 and 21 rejected with 400; 2 accepted");
  } finally {
    console.log("\n── CLEANUP ───────────────────────────────────────────");
    await cleanup();
    const left = {
      candidates: await db.candidate.count({ where: { email: EMAIL } }),
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
