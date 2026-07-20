import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";

/**
 * Resume file storage.
 *
 * Files are written to `.uploads/resumes/` at the project root — deliberately
 * OUTSIDE Next's `public/` directory. Anything under public/ is served
 * statically with no auth, which would put every applicant's CV (name, phone,
 * address, employment history) on the open internet behind a guessable URL.
 * Instead the stored key is opaque and the only way to read a file is through
 * app/api/resume/[applicationId]/route.ts, which checks role first.
 *
 * ponytail: local disk, single-instance. Fine at this scale and for dev, but
 * it does not survive a serverless deploy or horizontal scaling — swap the two
 * functions below for S3/R2/Supabase Storage when that day comes. Nothing else
 * in the codebase touches the filesystem, so the change is contained here.
 */

const RESUME_DIR = path.join(process.cwd(), ".uploads", "resumes");

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
  await mkdir(RESUME_DIR, { recursive: true });
  await writeFile(path.join(RESUME_DIR, key), bytes);
  return { ok: true, key };
}

/**
 * Read a stored resume by key.
 *
 * The key is validated against a strict pattern before it touches the
 * filesystem — a key like `../../.env` must never resolve outside RESUME_DIR.
 */
export async function readResume(key: string): Promise<Buffer | null> {
  if (!/^[0-9a-f-]{36}\.pdf$/i.test(key)) return null;
  try {
    return await readFile(path.join(RESUME_DIR, key));
  } catch {
    return null;
  }
}

/**
 * Delete a stored resume from disk.
 *
 * Essential to the retention policy: the resume file has NO database relation,
 * so deleting the Candidate row would otherwise leave the applicant's CV — the
 * single most personal artefact they gave us — sitting on disk forever. That
 * would be erasure in name only.
 *
 * Returns true if a file was removed, false if there was nothing to remove
 * (already gone, or a malformed key). A missing file is not an error: the goal
 * is "this file no longer exists", and it already doesn't.
 */
export async function deleteResume(key: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}\.pdf$/i.test(key)) return false;
  try {
    await unlink(path.join(RESUME_DIR, key));
    return true;
  } catch {
    return false;
  }
}
