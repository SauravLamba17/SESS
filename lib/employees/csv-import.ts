/**
 * Bulk employee CSV parsing and validation — pure, no DB access.
 *
 * The route fetches existing codes/managers once and passes them in, so the
 * whole file validates without a query per row, and this logic is testable
 * standalone.
 *
 * STRATEGY: VALIDATE EVERYTHING FIRST, then commit valid rows ALL-OR-NOTHING
 * in one transaction. Rationale in the route; the split here is that parsing
 * and validation never touch the database at all.
 */
import { parseDateOnly } from "../period.ts";

export const CSV_COLUMNS = [
  "employeeCode",
  "name",
  "department",
  "designation",
  "managerEmployeeCode",
  "joiningDate",
  "machineId",
  // Optional. Stored on the Employee for later Clerk-invitation matching.
  // Invitations are deliberately NOT sent at import time — HR sends them
  // per-employee from the roster when access is actually wanted.
  "email",
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

/** Columns without which a row cannot create an employee. */
const REQUIRED: CsvColumn[] = ["employeeCode", "name", "department", "joiningDate"];

export interface ParsedRow {
  lineNumber: number; // 1-based line in the file, header included
  employeeCode: string;
  name: string;
  department: string;
  designation: string | null;
  managerEmployeeCode: string | null;
  joiningDate: Date | null;
  machineId: string | null;
  email: string | null;
  raw: Record<string, string>;
}

export interface InvalidRow {
  lineNumber: number;
  employeeCode: string;
  reasons: string[];
}

export interface ValidationResult {
  valid: ParsedRow[];
  invalid: InvalidRow[];
  /** Header problems abort everything — no rows are even considered. */
  fatal: string | null;
}

/**
 * Minimal RFC-4180-ish CSV line splitter: handles quoted fields, embedded
 * commas, and doubled quotes. Deliberately not a CSV library — this is one
 * well-understood function for one known file shape.
 *
 * Does NOT support embedded newlines inside quoted fields; a row is a line.
 * That limitation is stated in the UI, since an employee name containing a
 * newline is not a real case.
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++; // doubled quote → literal quote
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}


export interface ValidationContext {
  /** employeeCodes already in the database (any status). */
  existingCodes: Set<string>;
  /** employeeCode → id, for ACTIVE employees only — valid manager targets. */
  activeManagerCodes: Map<string, string>;
  /** Emails (lowercased) already on Employee rows — email is unique. */
  existingEmails: Set<string>;
}

/**
 * Parse and validate a whole CSV. Never throws on bad data — every problem
 * becomes a reason string attached to its row.
 */
export function validateCsv(text: string, ctx: ValidationContext): ValidationResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l, i) => l.trim().length > 0 || i === 0);

  if (lines.length === 0 || !lines[0].trim())
    return { valid: [], invalid: [], fatal: "The file is empty." };

  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length > 0)
    return {
      valid: [],
      invalid: [],
      fatal: `Missing required column(s): ${missing.join(", ")}. Expected header: ${CSV_COLUMNS.join(", ")}`,
    };

  if (lines.length === 1)
    return { valid: [], invalid: [], fatal: "The file has a header but no data rows." };

  const idx = (c: CsvColumn) => header.indexOf(c);
  const valid: ParsedRow[] = [];
  const invalid: InvalidRow[] = [];

  // Duplicate detection WITHIN the file, independent of the database.
  const seenInFile = new Map<string, number>();
  const seenEmails = new Map<string, number>();

  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1; // 1-based, header is line 1
    const cells = splitCsvLine(lines[i]);
    const get = (c: CsvColumn): string => {
      const at = idx(c);
      return at === -1 ? "" : (cells[at] ?? "").trim();
    };

    const employeeCode = get("employeeCode");
    const name = get("name");
    const department = get("department");
    const joiningRaw = get("joiningDate");
    const managerCode = get("managerEmployeeCode");
    const reasons: string[] = [];

    if (!employeeCode) reasons.push("employeeCode is required");
    if (!name) reasons.push("name is required");
    if (!department) reasons.push("department is required");

    if (!joiningRaw) reasons.push("joiningDate is required");
    const joiningDate = joiningRaw ? parseDateOnly(joiningRaw) : null;
    if (joiningRaw && !joiningDate)
      reasons.push(`joiningDate "${joiningRaw}" is not a valid YYYY-MM-DD date`);

    if (employeeCode) {
      if (ctx.existingCodes.has(employeeCode))
        reasons.push(`employeeCode "${employeeCode}" already exists in the system`);
      const dupLine = seenInFile.get(employeeCode);
      if (dupLine !== undefined)
        reasons.push(`employeeCode "${employeeCode}" is duplicated (also on line ${dupLine})`);
      else seenInFile.set(employeeCode, lineNumber);
    }

    const email = get("email").toLowerCase() || null;
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        reasons.push(`email "${email}" is not a valid email address`);
      else {
        if (ctx.existingEmails.has(email))
          reasons.push(`email "${email}" already belongs to an employee in the system`);
        const dupLine = seenEmails.get(email);
        if (dupLine !== undefined)
          reasons.push(`email "${email}" is duplicated (also on line ${dupLine})`);
        else seenEmails.set(email, lineNumber);
      }
    }

    if (managerCode && !ctx.activeManagerCodes.has(managerCode))
      reasons.push(
        `managerEmployeeCode "${managerCode}" does not match any active employee`,
      );

    if (reasons.length > 0) {
      invalid.push({ lineNumber, employeeCode: employeeCode || "(blank)", reasons });
      continue;
    }

    valid.push({
      lineNumber,
      employeeCode,
      name,
      department,
      designation: get("designation") || null,
      managerEmployeeCode: managerCode || null,
      joiningDate,
      machineId: get("machineId") || null,
      email,
      raw: Object.fromEntries(header.map((h, j) => [h, cells[j] ?? ""])),
    });
  }

  return { valid, invalid, fatal: null };
}
