/**
 * Verification for the public application form's Terms & Conditions gate.
 *
 * Proves three things against the REAL running dev server and the REAL
 * database, not against mocks:
 *   1. A submission WITH acceptance succeeds and stores termsAcceptedAt +
 *      termsVersion correctly.
 *   2. A direct API call that simply OMITS the checkbox — exactly what a
 *      hand-crafted POST or a tampered form does — is rejected 400
 *      TERMS_NOT_ACCEPTED, and writes nothing.
 *   3. Sending an explicit wrong value is rejected the same way, so the check
 *      is on the value and not merely on the key's presence.
 *
 * Creates its own throwaway requisition/candidates and deletes everything,
 * pass or fail — including the stored resume files and the rate-limit rows it
 * generates (the endpoint allows 5 per IP per hour; this suite uses 3).
 *
 * Requires the dev server on :3005.
 * Run:  node --env-file=.env prisma/verify-terms-acceptance.ts
 */
import { PrismaClient } from "@prisma/client";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { TERMS_VERSION } from "../lib/recruitment/terms.ts";

// Literal rather than imported: lib/recruitment/rate-limit.ts pulls in
// "@/lib/db", and the "@/" alias does not resolve under plain Node. Mirrors
// CAREERS_APPLY_ACTION there. (lib/recruitment/terms.ts imports fine because it
// was deliberately written dependency-free.)
const CAREERS_APPLY_ACTION = "careers_apply";

const db = new PrismaClient();
const BASE = "http://127.0.0.1:3005";
const RESUME_DIR = path.join(process.cwd(), ".uploads", "resumes");

const TAG = "ZZ-TERMS-TEST";
const E_OK = "zz-terms-ok@example.invalid";
const E_OMIT = "zz-terms-omit@example.invalid";
const E_WRONG = "zz-terms-wrong@example.invalid";
const ALL_EMAILS = [E_OK, E_OMIT, E_WRONG];

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Smallest thing that satisfies storeResume's real %PDF- magic-byte check. */
function pdf(): File {
  const body = "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";
  return new File([new TextEncoder().encode(body)], "resume.pdf", {
    type: "application/pdf",
  });
}

function baseForm(requisitionId: string, name: string, email: string): FormData {
  const f = new FormData();
  f.set("requisitionId", requisitionId);
  f.set("name", name);
  f.set("email", email);
  f.set("phone", "+91 98765 43210");
  f.set("resume", pdf());
  return f;
}

async function cleanup() {
  // Resume files first — they have no DB relation and would otherwise survive.
  const cands = await db.candidate.findMany({
    where: { email: { in: ALL_EMAILS } },
    select: { id: true, resumeUrl: true },
  });
  for (const c of cands) {
    if (/^[0-9a-f-]{36}\.pdf$/i.test(c.resumeUrl)) {
      await unlink(path.join(RESUME_DIR, c.resumeUrl)).catch(() => {});
    }
  }
  const ids = cands.map((c) => c.id);
  await db.application.deleteMany({ where: { candidateId: { in: ids } } });
  await db.candidate.deleteMany({ where: { id: { in: ids } } });
  await db.notification.deleteMany({ where: { message: { contains: TAG } } });
  await db.jobRequisition.deleteMany({ where: { title: { contains: TAG } } });
  // The suite's own rate-limit attempts, so a re-run starts from a clean budget.
  await db.rateLimitAttempt.deleteMany({
    where: { action: CAREERS_APPLY_ACTION, key: { in: ["127.0.0.1", "::1", "unknown"] } },
  });
}

async function main() {
  console.log("Terms & Conditions acceptance gate\n");

  const up = await fetch(`${BASE}/careers`).then((r) => r.ok).catch(() => false);
  if (!up) {
    console.error(`Dev server not reachable at ${BASE}. Start it first.`);
    process.exit(1);
  }

  await cleanup();

  const req = await db.jobRequisition.create({
    data: {
      title: `${TAG} Test Role`,
      department: "Engineering",
      description: "Throwaway requisition for the T&C verification suite.",
      openings: 1,
      status: "OPEN",
      createdBy: `${TAG}-suite`,
    },
  });

  try {
    // ── 1. Public terms page must be reachable with NO authentication ──────
    const terms = await fetch(`${BASE}/careers/terms`, { redirect: "manual" });
    check("GET /careers/terms is public", terms.status === 200, `status ${terms.status}`);
    const termsHtml = await terms.text();
    check(
      "terms page states the 1-year retention",
      /retained for 1 year/i.test(termsHtml),
    );
    check(
      "terms page does NOT mention an unreachable 2-year tier",
      !/2 years|two years|talent pool/i.test(termsHtml),
    );

    // ── 2. Acceptance given → succeeds and is recorded ─────────────────────
    const before = new Date();
    const okForm = baseForm(req.id, `${TAG} Accepted`, E_OK);
    okForm.set("termsAccepted", "yes");
    const okRes = await fetch(`${BASE}/api/careers/apply`, { method: "POST", body: okForm });
    const okJson = await okRes.json().catch(() => ({}));
    check("submission WITH acceptance succeeds", okRes.status === 200 && okJson.ok === true,
      `status ${okRes.status} ${JSON.stringify(okJson)}`);

    const after = new Date();
    const stored = await db.application.findUnique({
      where: { id: okJson.applicationId ?? "" },
      select: { id: true, termsAcceptedAt: true, termsVersion: true },
    });
    check("Application row exists", !!stored);
    check(
      "termsVersion recorded correctly",
      stored?.termsVersion === TERMS_VERSION,
      `got ${JSON.stringify(stored?.termsVersion)}, expected ${JSON.stringify(TERMS_VERSION)}`,
    );
    check(
      "termsAcceptedAt is a timestamp from this submission",
      !!stored?.termsAcceptedAt &&
        stored.termsAcceptedAt >= new Date(before.getTime() - 1000) &&
        stored.termsAcceptedAt <= new Date(after.getTime() + 1000),
      stored?.termsAcceptedAt?.toISOString() ?? "null",
    );

    // ── 3. THE REAL TEST: direct API call omitting the field entirely ──────
    // This is what an unchecked checkbox actually sends: nothing at all.
    const omitForm = baseForm(req.id, `${TAG} Omitted`, E_OMIT);
    const omitRes = await fetch(`${BASE}/api/careers/apply`, { method: "POST", body: omitForm });
    const omitJson = await omitRes.json().catch(() => ({}));
    check("submission OMITTING acceptance is rejected", omitRes.status === 400,
      `status ${omitRes.status}`);
    check("rejection uses the TERMS_NOT_ACCEPTED code", omitJson.code === "TERMS_NOT_ACCEPTED",
      `code ${JSON.stringify(omitJson.code)}`);
    check("rejection carries a human-readable error", typeof omitJson.error === "string" && omitJson.error.length > 10,
      JSON.stringify(omitJson.error));
    check("rejection was NOT silently accepted",
      omitJson.ok !== true && !omitJson.applicationId);

    const omitCand = await db.candidate.findFirst({ where: { email: E_OMIT } });
    check("no Candidate row written for the rejected submission", omitCand === null);

    // ── 4. Explicit wrong value is rejected too (value-checked, not key) ───
    const wrongForm = baseForm(req.id, `${TAG} Wrong`, E_WRONG);
    wrongForm.set("termsAccepted", "no");
    const wrongRes = await fetch(`${BASE}/api/careers/apply`, { method: "POST", body: wrongForm });
    const wrongJson = await wrongRes.json().catch(() => ({}));
    check('termsAccepted="no" is rejected',
      wrongRes.status === 400 && wrongJson.code === "TERMS_NOT_ACCEPTED",
      `status ${wrongRes.status} code ${JSON.stringify(wrongJson.code)}`);
    const wrongCand = await db.candidate.findFirst({ where: { email: E_WRONG } });
    check("no Candidate row written for the wrong-value submission", wrongCand === null);

    // ── 5. Talent-pool backend field untouched, and now always false ───────
    const okCand = await db.candidate.findFirst({
      where: { email: E_OK },
      select: { talentPoolConsent: true, talentPoolConsentAt: true, scheduledDeletionAt: true },
    });
    check("talentPoolConsent is false (checkbox removed, field intact)",
      okCand?.talentPoolConsent === false, `got ${okCand?.talentPoolConsent}`);
    check("talentPoolConsentAt is null", okCand?.talentPoolConsentAt === null);
    check("scheduledDeletionAt untouched at submission time", okCand?.scheduledDeletionAt === null);
  } finally {
    await cleanup();
    console.log("\n  cleanup: throwaway requisition, candidates, applications, resumes and rate-limit rows removed");
  }

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("suite crashed:", e);
  await cleanup().catch(() => {});
  await db.$disconnect();
  process.exit(1);
});
