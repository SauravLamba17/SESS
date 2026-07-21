import type { Prisma } from "@prisma/client";

/**
 * Audit-log query construction — pure, so the filter/pagination logic is
 * testable without a database and cannot drift from what the page runs.
 *
 * SERVER-SIDE PAGINATION, always. The viewer issues `skip`/`take` against
 * Postgres and never loads the full table; at real volume (this log grows
 * forever and is never pruned) fetching everything to slice in the browser
 * would be the difference between a 40-row response and a 400,000-row one.
 */

export const AUDIT_PAGE_SIZE = 50;
/** Hard ceiling — a hand-crafted `?pageSize=100000` must not become a full scan. */
export const AUDIT_MAX_PAGE_SIZE = 200;

export interface AuditFilters {
  action?: string | null;
  actor?: string | null;
  from?: string | null; // YYYY-MM-DD inclusive
  to?: string | null; // YYYY-MM-DD inclusive
  page?: number;
  pageSize?: number;
}

/** Parse a YYYY-MM-DD string to local midnight, or null. */
export function parseDateOnly(v: string | null | undefined): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return null;
  const [y, m, d] = v.trim().split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export interface ResolvedAuditQuery {
  where: Prisma.AuditLogWhereInput;
  skip: number;
  take: number;
  page: number;
  pageSize: number;
}

/**
 * Build the Prisma where/skip/take from raw (untrusted) filter input.
 *
 * The `to` bound is made EXCLUSIVE-next-day so a filter of
 * from=2026-07-20&to=2026-07-20 includes everything that happened that day,
 * rather than only the single instant at midnight.
 */
export function buildAuditQuery(f: AuditFilters): ResolvedAuditQuery {
  const where: Prisma.AuditLogWhereInput = {};

  const action = f.action?.trim();
  if (action) where.action = action;

  const actor = f.actor?.trim();
  // `contains` — free-text search on actor, per the brief. Case-insensitive so
  // a Clerk id typed in the wrong case still matches.
  if (actor) where.actorUserId = { contains: actor, mode: "insensitive" };

  const from = parseDateOnly(f.from);
  const to = parseDateOnly(f.to);
  if (from || to) {
    where.timestamp = {
      ...(from ? { gte: from } : {}),
      ...(to
        ? { lt: new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1) }
        : {}),
    };
  }

  const pageSize = Math.min(
    Math.max(1, Math.trunc(f.pageSize ?? AUDIT_PAGE_SIZE)),
    AUDIT_MAX_PAGE_SIZE,
  );
  const page = Math.max(1, Math.trunc(f.page ?? 1));

  return { where, skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

export function totalPages(totalRows: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalRows / pageSize));
}
