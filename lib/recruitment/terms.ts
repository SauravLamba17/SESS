/**
 * Candidate-facing Terms & Conditions: the single source of truth for the
 * version string and the contact address.
 *
 * Deliberately dependency-free (no "server-only", no imports): it is read by
 * the public terms PAGE, by the application FORM's link, and by the API route
 * that stamps acceptance. A shared constant is the whole point — a terms
 * update or a real HR address must be a one-line edit here, not a hunt across
 * three files.
 */

/**
 * The version an applicant is agreeing to RIGHT NOW.
 *
 * Stamped onto Application.termsVersion at submission time. Bump this whenever
 * the wording on /careers/terms materially changes, so an applicant who agreed
 * to the old text is never retroactively recorded as having agreed to the new
 * one. Old rows keep their old string — that is the entire reason the column
 * exists rather than just a boolean.
 *
 * Format: YYYY-MM-vN.
 */
export const TERMS_VERSION = "2026-08-v1";

/**
 * Where a candidate writes to ask about, or request deletion of, their data.
 *
 * ⚠️ PLACEHOLDER — replace with the real monitored address before launch.
 * Shown on /careers/terms as the sole contact route for a deletion request.
 */
export const HR_CONTACT_EMAIL = "careers@example.com";

/** The public terms page. Linked from the application form's consent checkbox. */
export const TERMS_PATH = "/careers/terms";

/**
 * How long an applicant's data is retained, as stated to them on the terms
 * page. Kept next to the version string so the promise and the version that
 * made it travel together.
 *
 * This MIRRORS lib/recruitment/retention.ts's RETENTION_DAYS_NO_CONSENT (365)
 * — it does not drive it. The retention engine remains the only thing that
 * decides actual dates; this is the sentence shown to a human.
 */
export const RETENTION_STATEMENT_YEARS = 1;
