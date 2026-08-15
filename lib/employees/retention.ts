// Employee data retention — REDACTION, never deletion.
//
// ─── WHY THIS IS NOT THE CANDIDATE RETENTION PATTERN ─────────────────────
// lib/recruitment/retention.ts DELETES a rejected candidate's rows, and that is
// right for a candidate: once they are not hired there is no ongoing lawful
// basis to hold their CV and contact details.
//
// A former EMPLOYEE is the opposite case. The reason a 5-year clock exists at
// all is that their payroll, tax and attendance records MUST be retained and
// auditable for that period. Deleting an Employee row would take the whole
// foreign-key graph with it — Payroll, Attendance, Production, QualityReport,
// AppraisalScore, WarningLetter, LeaveRequest, ExpenseClaim, SalaryAdvance,
// ConsentRecord, OnboardingTask, IdleLog, ShoutOut, SalaryStructure,
// SalaryStructureHistory, Notification, AgentToken, User — and destroy the very
// records the retention period exists to preserve.
//
// So what expires is not the record. It is the DIRECT PERSONAL IDENTIFIERS
// that are no longer needed once the statutory window closes. Everything else
// stays, permanently and queryable.
// ─────────────────────────────────────────────────────────────────────────
//
// Pure. No DB access — the route supplies rows and applies the returned patch.

// Relative + explicit .ts, NOT the "@/" alias: prisma/verify-phase13.ts and
// verify-redaction-robustness.ts load this module under plain Node, which
// cannot resolve the alias.
import { ymd } from "../reports/range.ts";

/** Five years, in whole years, applied to the last working day. */
export const RETENTION_YEARS = 5;

/** Default extension when HR has an active reason to keep full data longer. */
export const EXTENSION_YEARS = 1;

/** The marker written into redacted string fields. Recognisable, not blank —
 *  a null would read as "was never recorded" rather than "deliberately erased". */
export const REDACTION_MARKER = "[REDACTED]";

/** Add whole years, clamping the day (29 Feb + 5y → 28 Feb). */
export function addYears(from: Date, years: number): Date {
  const d = new Date(from.getFullYear() + years, from.getMonth(), from.getDate());
  // A Feb-29 start rolls into March in a non-leap year; pull it back.
  if (d.getMonth() !== from.getMonth()) d.setDate(0);
  return d;
}

/** When an employee offboarded on `lastWorkingDay` becomes due for redaction. */
export function scheduledRedactionFor(lastWorkingDay: Date): Date {
  return addYears(lastWorkingDay, RETENTION_YEARS);
}

/**
 * THE FIELDS THAT GET REDACTED, and nothing else.
 *
 * Each one is a direct personal identifier with no audit or payroll purpose
 * once the retention window has closed:
 *   email             — personal contact address
 *   emergencyContact  — a THIRD PARTY's name and phone; that person never had
 *                       an employment relationship with the company at all,
 *                       which makes it the least defensible field to keep
 *   dateOfBirth       — used only for the birthday widget
 *   pendingInvitationId — a dangling Clerk invitation token
 *
 * ─── WHAT IS DELIBERATELY KEPT, AND WHY ──────────────────────────────────
 * name           — KEPT. This is a real judgement call, so it is stated
 *                  plainly: a payslip, a Form 16 and a warning letter are
 *                  legal documents that NAME the person they concern. Redacting
 *                  the name would leave payroll records that cannot be tied to
 *                  a human being, defeating the audit purpose the retention
 *                  period exists to serve, and would make a lawful subject
 *                  access request unanswerable. The name is retained as part of
 *                  the financial record, not as contact data. If a specific
 *                  erasure request ever requires the name to go too, that is a
 *                  deliberate legal decision for a human — not this default.
 * employeeCode   — the join key every financial record is filed under.
 * department,
 * designation    — organisational context a payroll audit reads.
 * joiningDate,
 * offboardedAt   — the employment window itself; pro-ration depends on it.
 * machineId,
 * pfUan          — pfUan appears on statutory filings; it identifies a PF
 *                  account, not a private individual's contact details.
 * shiftId, managerId — structural, not personal.
 *
 * AND EVERY RELATED TABLE IS UNTOUCHED. This function returns a patch for the
 * Employee row alone; the route applies exactly that and nothing more.
 */
export interface RedactionPatch {
  email: null;
  emergencyContact: string;
  dateOfBirth: null;
  pendingInvitationId: null;
  redactedAt: Date;
  scheduledRedactionAt: null;
}

export function redactionPatch(now = new Date()): RedactionPatch {
  return {
    // email is @unique — a marker string would collide on the second
    // redaction, so this one field becomes null. The redactedAt flag below is
    // what records that erasure happened, so nothing is ambiguous.
    email: null,
    emergencyContact: REDACTION_MARKER,
    dateOfBirth: null,
    pendingInvitationId: null,
    redactedAt: now,
    // The clock has run out and been acted on; it no longer applies.
    scheduledRedactionAt: null,
  };
}

/** Field names this policy touches, for the confirmation UI and the audit row. */
export const REDACTED_FIELDS = [
  "email",
  "emergencyContact",
  "dateOfBirth",
  "pendingInvitationId",
] as const;

/** Field names explicitly preserved, shown to HR before they confirm. */
export const PRESERVED_FIELDS = [
  "name",
  "employeeCode",
  "department",
  "designation",
  "joiningDate",
  "offboardedAt",
  "pfUan",
] as const;

export type RetentionEligibility =
  | { ok: true }
  | { ok: false; code: "NOT_OFFBOARDED" | "ALREADY_REDACTED" | "NOT_DUE"; message: string };

/** Is this employee actually due for redaction right now? */
export function checkEligibility(
  employee: {
    active: boolean;
    offboardedAt: Date | null;
    scheduledRedactionAt: Date | null;
    redactedAt: Date | null;
  },
  now = new Date(),
): RetentionEligibility {
  if (employee.active || !employee.offboardedAt)
    return {
      ok: false,
      code: "NOT_OFFBOARDED",
      message:
        "This employee is still active. The retention clock only starts on their last working day.",
    };

  if (employee.redactedAt)
    return {
      ok: false,
      code: "ALREADY_REDACTED",
      message: `Personal data was already redacted on ${ymd(
        employee.redactedAt,
      )}. Redaction is one-way and does not need repeating.`,
    };

  if (!employee.scheduledRedactionAt || employee.scheduledRedactionAt > now)
    return {
      ok: false,
      code: "NOT_DUE",
      message: employee.scheduledRedactionAt
        ? `Not due until ${ymd(
            employee.scheduledRedactionAt,
          )} — ${RETENTION_YEARS} years after their last working day.`
        : "This employee has no scheduled redaction date.",
    };

  return { ok: true };
}
