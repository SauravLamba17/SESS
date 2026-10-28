import "server-only";
import { randomUUID } from "node:crypto";

/**
 * Resume file storage — a PRIVATE Supabase Storage bucket.
 *
 * The old version wrote to `.uploads/resumes/` on local disk. Vercel functions
 * have a read-only filesystem, so every career-page application failed with a
 * 503 in production. Storage is now Supabase's REST API over plain fetch (no SDK).
 *
 * The bucket is private and only the server holds the service-role key, so
 * there is no public URL to leak or guess. The only way to read a file is
 * app/api/resume/[applicationId]/route.ts, which checks role first.
 *
 * Config (server-only, never NEXT_PUBLIC_):
 *   SUPABASE_URL               https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  the project's service_role key
 *   RESUME_BUCKET              optional, defaults to "resumes"
 */

function storageConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Resume storage is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  const bucket = process.env.RESUME_BUCKET || "resumes";
  return { base: `${url}/storage/v1/object/${bucket}`, headers: { Authorization: `Bearer ${key}`, apikey: key } };
}

/** Keys are always our own `<uuid>.pdf`; anything else is never sent to storage. */
const KEY_RE = /^[0-9a-f-]{36}\.pdf$/i;

export const MAX_RESUME_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_RESUME_MIME = "application/pdf";

/** `%PDF-` — the real magic bytes. A client-supplied MIME type is a claim, not
 *  evidence, so the header is checked too. */
function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d // -
  );
}

export type StoreResult =
  | { ok: true; key: string }
  | { ok: false; code: "TOO_LARGE" | "WRONG_TYPE" | "EMPTY"; message: string };

/** Validate and persist a resume. Returns the opaque storage key. */
export async function storeResume(file: File): Promise<StoreResult> {
  if (!file || file.size === 0)
    return { ok: false, code: "EMPTY", message: "No resume file was received." };

  if (file.size > MAX_RESUME_BYTES)
    return {
      ok: false,
      code: "TOO_LARGE",
      message: `Resume must be 5 MB or smaller — this file is ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
    };

  if (file.type && file.type !== ALLOWED_RESUME_MIME)
    return {
      ok: false,
      code: "WRONG_TYPE",
      message: "Resume must be a PDF file.",
    };

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes))
    return {
      ok: false,
      code: "WRONG_TYPE",
      message: "That file is not a valid PDF. Please upload a PDF resume.",
    };

  // Opaque, unguessable filename — the key is never the candidate's name.
  const key = `${randomUUID()}.pdf`;
  const { base, headers } = storageConfig();
  const res = await fetch(`${base}/${key}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": ALLOWED_RESUME_MIME, "x-upsert": "false" },
    body: bytes,
    cache: "no-store",
  });
  // Thrown, not returned: the caller's catch turns it into a 503 and logs it,
  // and no Candidate row is written for a file that was never stored.
  if (!res.ok) throw new Error(`Resume upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return { ok: true, key };
}

/**
 * Read a stored resume by key. Null when the key is malformed or the object
 * does not exist; any other storage failure throws (the route returns 503).
 *
 * The key is validated against a strict pattern before it reaches storage —
 * a key like `../other-bucket/x` must never be requested.
 */
export async function readResume(key: string): Promise<Buffer | null> {
  if (!KEY_RE.test(key)) return null;
  const { base, headers } = storageConfig();
  const res = await fetch(`${base}/${key}`, { headers, cache: "no-store" });
  // Supabase answers a missing object with 400 or 404 depending on version.
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`Resume read failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Delete a stored resume.
 *
 * Essential to the retention policy: the resume file has NO database relation,
 * so deleting the Candidate row would otherwise leave the applicant's CV — the
 * single most personal artefact they gave us — in storage forever. That would
 * be erasure in name only.
 *
 * Returns true if a file was removed, false if there was nothing to remove
 * (already gone, or a malformed key). A missing file is not an error: the goal
 * is "this file no longer exists", and it already doesn't.
 */
export async function deleteResume(key: string): Promise<boolean> {
  if (!KEY_RE.test(key)) return false;
  try {
    const { base, headers } = storageConfig();
    const res = await fetch(`${base}/${key}`, { method: "DELETE", headers, cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}
