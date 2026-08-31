import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { storeResume } from "@/lib/recruitment/storage";
import { checkRateLimit, clientIp } from "@/lib/recruitment/rate-limit";
import { notifyHrOfApplication } from "@/lib/recruitment/notify";
import { TERMS_VERSION } from "@/lib/recruitment/terms";
import { fail } from "@/lib/api/response";
import { onRecruitmentChanged } from "@/lib/invalidation/employee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * PUBLIC, UNAUTHENTICATED application submission.
 *
 * This is the only endpoint in the application that any stranger on the
 * internet can reach, so it validates everything and trusts nothing:
 *  - per-IP rate limit (429)
 *  - honeypot field that real users never see or fill
 *  - requisition must exist AND be OPEN — checked HERE, server-side, not just
 *    by omitting closed roles from the careers page
 *  - resume validated by size, MIME and actual PDF magic bytes, then stored
 *    outside the web root
 *  - field lengths capped so the form cannot be used to write novels into the DB
 *
 * It deliberately reveals nothing about existing candidates: a duplicate
 * application returns the same generic 409 regardless of who applied.
 */
export async function POST(req: NextRequest) {
  // ── Rate limit before any parsing, so a flood costs us as little as possible.
  const ip = clientIp(req.headers);
  const rate = await checkRateLimit(ip);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: `Too many applications from this network. Please try again in about ${Math.ceil(rate.retryAfterSeconds / 60)} minute(s).`,
        code: "RATE_LIMITED",
      },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("BAD_INPUT", "Could not read the submitted form.", 400);
  }

  // ── Honeypot: a hidden field. A human never fills it; a naive bot fills
  // everything. Respond 200 so the bot believes it succeeded and doesn't retry.
  if (str(form.get("website"))) {
    return NextResponse.json({ ok: true });
  }

  const requisitionId = str(form.get("requisitionId"));
  const name = str(form.get("name"));
  const email = str(form.get("email")).toLowerCase();
  const phone = str(form.get("phone"));

  if (!requisitionId) return fail("BAD_INPUT", "Missing job reference.", 400);
  if (!name || name.length > 120)
    return fail("BAD_INPUT", "Please enter your full name (under 120 characters).", 400);
  // Intentionally permissive: an over-strict email regex rejects valid
  // addresses, and HR contacts these people by hand anyway.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200)
    return fail("BAD_INPUT", "Please enter a valid email address.", 400);
  if (!/^[\d+\-() ]{6,20}$/.test(phone))
    return fail("BAD_INPUT", "Please enter a valid phone number.", 400);

  // ── Terms & Conditions: REQUIRED, and enforced here rather than by the
  // disabled submit button. An unchecked HTML checkbox submits nothing, so
  // absence is the normal "not accepted" signal — and a hand-crafted POST that
  // simply omits the field lands in exactly the same branch. There is no shape
  // of request that stores an application without acceptance on file.
  //
  // Checked BEFORE the resume is read or stored, so a rejected submission
  // never writes a file we would then have to clean up.
  const termsAccepted = str(form.get("termsAccepted")) === "yes";
  if (!termsAccepted)
    return fail(
      "TERMS_NOT_ACCEPTED",
      "Please read and agree to the Terms and Conditions before submitting your application.",
      400,
    );

  const file = form.get("resume");
  if (!(file instanceof File))
    return fail("BAD_INPUT", "Please attach your resume as a PDF.", 400);

  try {
    // ── The requisition must be OPEN. Enforced server-side: a stale tab or a
    // hand-crafted POST must not be able to apply to a closed role.
    const req_ = await db.jobRequisition.findUnique({
      where: { id: requisitionId },
      select: { id: true, status: true, title: true },
    });
    if (!req_)
      return fail("NOT_FOUND", "That job posting no longer exists.", 404);
    if (req_.status !== "OPEN")
      return fail(
        "REQUISITION_CLOSED",
        `Applications for “${req_.title}” are closed. Please see our other open roles.`,
        409,
      );

    // ── Reuse the candidate record for a repeat applicant, so one person
    // applying to three roles is one Candidate with three Applications.
    const existingCandidate = await db.candidate.findFirst({
      where: { email },
      select: { id: true },
    });

    if (existingCandidate) {
      const dupe = await db.application.findUnique({
        where: {
          candidateId_jobRequisitionId: {
            candidateId: existingCandidate.id,
            jobRequisitionId: requisitionId,
          },
        },
        select: { id: true },
      });
      if (dupe)
        return fail(
          "ALREADY_APPLIED",
          "You have already applied for this role. We will be in touch.",
          409,
        );
    }

    // Store the file only after every cheap check has passed.
    const stored = await storeResume(file);
    if (!stored.ok) return fail(stored.code, stored.message, 400);

    const result = await db.$transaction(async (tx) => {
      const now = new Date();

      // ── Talent pool: the career-page checkbox that used to set this was
      // removed, so a public applicant can no longer opt in and this is now
      // always false. The FIELDS and the retention engine that reads them
      // (lib/recruitment/retention.ts) are deliberately untouched — the
      // 2-year consented tier still exists in code, it is simply no longer
      // reachable from this form. Written explicitly rather than left to the
      // schema default so the behaviour is stated, not inferred: a repeat
      // applicant's row is cleared exactly as it was when they left the old
      // box unticked.
      const talentPoolConsent = false;
      const consentAt = null;

      const candidate = existingCandidate
        ? await tx.candidate.update({
            where: { id: existingCandidate.id },
            // Latest submission carries the most current details + resume.
            data: {
              name,
              phone,
              resumeUrl: stored.key,
              talentPoolConsent,
              // Only stamp a consent time when consent is actually given; a
              // withdrawal on a later application clears it.
              talentPoolConsentAt: consentAt,
              // Re-applying is fresh engagement — an earlier deletion clock
              // from a previous rejection should not keep running.
              scheduledDeletionAt: null,
            },
          })
        : await tx.candidate.create({
            data: {
              name,
              email,
              phone,
              resumeUrl: stored.key,
              source: "Career Page",
              talentPoolConsent,
              talentPoolConsentAt: consentAt,
            },
          });

      const application = await tx.application.create({
        data: {
          candidateId: candidate.id,
          jobRequisitionId: requisitionId,
          // stage defaults to APPLIED — a human moves it from here.
          // Acceptance is stamped in the same transaction as the application
          // it belongs to: there is no window in which a row exists without
          // its terms record.
          termsAcceptedAt: now,
          termsVersion: TERMS_VERSION,
        },
      });

      // Same Notification model and createMany pattern as Phase 7's
      // PAYSLIP_READY, in the same transaction as the write it describes.
      const notified = await notifyHrOfApplication(tx, {
        candidateName: name,
        requisitionTitle: req_.title,
      });

      return { application, notified };
    });

    // A zero-recipient notification is not an error for the APPLICANT — their
    // application is safely stored either way — but it means nobody in HR was
    // told, so it must not pass silently. See lib/recruitment/notify.ts.
    if (result.notified.noRecipients) {
      console.warn(
        `[careers/apply] Application ${result.application.id} stored, but NO HR recipient exists ` +
          `(no active Employee linked to a User with role HR). Nobody was notified.`,
      );
    }

    // §2 "Recruitment dashboard · invalidate when candidate/application
    // change" — this application just moved the count HR reads on
    // /hr/requisitions. The candidate's own details are not cached at all.
    onRecruitmentChanged();

    return NextResponse.json({ ok: true, applicationId: result.application.id });
  } catch (err) {
    // Unique-constraint backstop if two submissions race the duplicate check.
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002")
      return fail(
        "ALREADY_APPLIED",
        "You have already applied for this role. We will be in touch.",
        409,
      );
    console.error("[careers/apply] failed:", err);
    return fail(
      "SERVER_ERROR",
      "We could not submit your application right now. Please try again shortly.",
      503,
    );
  }
}
