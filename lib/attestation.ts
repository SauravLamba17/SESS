/**
 * Attestation Record — NOT a legal digital signature.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHAT THIS IS
 *   A record that a named person typed their own name at a known time from a
 *   known IP, to acknowledge a document. Meaningfully stronger evidence than
 *   a bare `acknowledged = true` checkbox, because it captures WHAT was typed,
 *   WHEN, and FROM WHERE.
 *
 * WHAT THIS IS NOT
 *   A legally-binding electronic signature. Under India's Information
 *   Technology Act 2000 (ss. 3/3A and the Second Schedule), a legally
 *   recognised e-signature requires either a Digital Signature Certificate
 *   from a licensed Certifying Authority, or an Aadhaar-based eSign service
 *   from an empanelled provider. This module involves neither: there is no
 *   cryptographic key, no certificate, no trusted third party, and no
 *   tamper-evident seal. A typed name is not a signature.
 *
 *   If genuine legal enforceability is ever needed, integrate a licensed
 *   provider — do NOT extend this module to look more official.
 *
 * Every UI surface rendering these fields must label them "Attestation Record"
 * with the note "(internal record, not a legal digital signature)".
 * ─────────────────────────────────────────────────────────────────────
 */

/**
 * Client IP, same extraction the attendance punch route uses.
 *
 * Returns null rather than a placeholder when no header is present: a null IP
 * honestly records "we don't know", whereas "unknown" stored as a string would
 * look like evidence.
 */
export function attestationIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip")?.trim();
  return real || null;
}

/**
 * Normalise a name for comparison: case-insensitive, and collapses runs of
 * whitespace so "Asha  Verma" matches "asha verma". Deliberately does NOT
 * strip punctuation or accents — "O'Neill" must still have to type the
 * apostrophe, or the check would be meaninglessly loose.
 */
export function normaliseName(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export type AttestationCheck =
  | { ok: true; attestedName: string }
  | { ok: false; code: "EMPTY" | "MISMATCH"; message: string };

/**
 * Validate a typed name against the name of record.
 *
 * The STORED value is what the person actually typed (trimmed), not the
 * canonical name — the record should reflect their input, not ours.
 */
export function checkAttestation(typed: unknown, expected: string): AttestationCheck {
  const raw = typeof typed === "string" ? typed.trim() : "";
  if (!raw)
    return {
      ok: false,
      code: "EMPTY",
      message: "Type your full name to complete the attestation.",
    };

  if (normaliseName(raw) !== normaliseName(expected))
    return {
      ok: false,
      code: "MISMATCH",
      message: `The name you typed does not match the name on record ("${expected}"). Type it exactly as shown.`,
    };

  return { ok: true, attestedName: raw };
}

/** The disclaimer string, defined once so every surface says the same thing. */
export const ATTESTATION_LABEL = "Attestation Record";
export const ATTESTATION_DISCLAIMER =
  "(internal record, not a legal digital signature)";
