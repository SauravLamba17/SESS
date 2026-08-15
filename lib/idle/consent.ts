import type { Prisma } from "@prisma/client";
// Relative + explicit .ts, NOT the "@/" alias: prisma/verify-idle-tracking.ts
// loads this module under plain Node, which cannot resolve the alias. An
// "@/lib/reports/range" here made that whole suite die at import with
// ERR_MODULE_NOT_FOUND before running a single check — a silent loss of the
// regression cover on a consent-gated subsystem. Same rule as instrumentation.ts.
import { ymd } from "../reports/range.ts";

/**
 * IDLE_TRACKING consent resolution — the single gate for the whole subsystem.
 *
 * ─── SCOPE CONSTRAINT (deliberate, not an oversight) ──────────────────
 * This subsystem records ONLY idle-vs-active minutes, derived from whether
 * the OS reports keyboard/mouse input within a threshold. It captures NO
 * screenshots, NO application or window titles, NO URLs, NO keystrokes, and
 * assigns NO productivity score or "productive/unproductive" classification.
 * That is the intended product, not a first cut to be extended later: this is
 * the least invasive form this category of software can take while still
 * answering "was this machine in use?".
 * ─────────────────────────────────────────────────────────────────────
 *
 * CONSENT IS THE GATE. No active consent → no tracking, and the server
 * REJECTS heartbeats rather than quietly accepting and storing them. A record
 * stored without a lawful basis is worse than a gap in the data.
 */

export type Tx = Prisma.TransactionClient;

export const IDLE_CONSENT_TYPE = "IDLE_TRACKING";

export type ConsentState =
  | { active: true; givenOn: Date; expiresOn: Date | null }
  | { active: false; reason: "NEVER_GIVEN" | "EXPIRED"; expiredOn?: Date };

/**
 * Is IDLE_TRACKING consent currently active for this employee?
 *
 * Matches how app/hr/compliance/page.tsx already reads consent: the LATEST
 * record of the type wins, and it is expired once `retentionExpiry` is in the
 * past. A null `retentionExpiry` means open-ended consent.
 *
 * Revocation is therefore expressed by recording a consent whose
 * retentionExpiry has passed — the same mechanism the compliance page already
 * displays as "(expired)", rather than inventing a second revocation flag that
 * the existing UI would not understand.
 */
export async function idleConsentState(
  tx: Tx,
  employeeId: string,
  now = new Date(),
): Promise<ConsentState> {
  const latest = await tx.consentRecord.findFirst({
    where: { employeeId, consentType: IDLE_CONSENT_TYPE },
    orderBy: { givenOn: "desc" },
    select: { givenOn: true, retentionExpiry: true },
  });

  if (!latest) return { active: false, reason: "NEVER_GIVEN" };

  if (latest.retentionExpiry && latest.retentionExpiry < now)
    return { active: false, reason: "EXPIRED", expiredOn: latest.retentionExpiry };

  return { active: true, givenOn: latest.givenOn, expiresOn: latest.retentionExpiry };
}

/** Bulk version for the aggregate views — one query for the whole roster. */
export async function idleConsentStates(
  tx: Tx,
  employeeIds: string[],
  now = new Date(),
): Promise<Map<string, ConsentState>> {
  const out = new Map<string, ConsentState>();
  if (employeeIds.length === 0) return out;

  const records = await tx.consentRecord.findMany({
    where: { employeeId: { in: employeeIds }, consentType: IDLE_CONSENT_TYPE },
    orderBy: { givenOn: "desc" },
    select: { employeeId: true, givenOn: true, retentionExpiry: true },
  });

  // Ordered newest-first, so the first record seen per employee is the latest.
  const latestBy = new Map<string, (typeof records)[0]>();
  for (const r of records) if (!latestBy.has(r.employeeId)) latestBy.set(r.employeeId, r);

  for (const id of employeeIds) {
    const latest = latestBy.get(id);
    if (!latest) {
      out.set(id, { active: false, reason: "NEVER_GIVEN" });
    } else if (latest.retentionExpiry && latest.retentionExpiry < now) {
      out.set(id, { active: false, reason: "EXPIRED", expiredOn: latest.retentionExpiry });
    } else {
      out.set(id, { active: true, givenOn: latest.givenOn, expiresOn: latest.retentionExpiry });
    }
  }
  return out;
}

/** Human-readable state for the aggregate views. */
export function consentLabel(s: ConsentState): string {
  if (s.active) return s.expiresOn ? `Consented until ${ymd(s.expiresOn)}` : "Consented";
  return s.reason === "NEVER_GIVEN"
    ? "Tracking paused — consent not recorded"
    : `Tracking paused — consent expired ${s.expiredOn ? ymd(s.expiredOn) : ""}`.trim();
}

