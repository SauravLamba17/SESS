import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";

/**
 * GREEN TIER — SESS_Caching_Strategy.docx §2/§4.
 * Department list. Changes only when someone is onboarded, offboarded or
 * bulk-imported, so it carries the long TTL and relies on explicit
 * invalidation (lib/invalidation/employee.ts) rather than expiry.
 *
 * THERE IS NO Department TABLE in this schema — `department` is a String
 * column on Employee (prisma/schema.prisma:76). So the "department list" is a
 * DISTINCT over active employees, which is exactly the query
 * app/hr/page.tsx was already running inline.
 *
 * DESIGNATIONS / JOB TITLES (§2, §4 GREEN) are deliberately absent from this
 * file: `designation` is likewise free text on Employee (schema line 77) and
 * NO code path anywhere in this repo lists distinct designations — there is no
 * dropdown, no filter, no report grouping on it. A cached reader with no call
 * site is dead code, so one is not added. If a designation picker is ever
 * built, it belongs here with TAG_DEPARTMENTS' sibling tag and the same TTL.
 */

export const TAG_DEPARTMENTS = "departments";

/** §2: departments — 1–24 hr. One hour, the conservative end. */
export const DEPARTMENTS_TTL = 3600;

/**
 * Distinct departments across ACTIVE employees, alphabetical.
 *
 * Returns plain strings. Everything this module caches must survive the Data
 * Cache's JSON round-trip — `unstable_cache` serialises what it stores, so a
 * Date comes back as a string and a Prisma.Decimal comes back broken. Cached
 * readers in lib/cache/ therefore return projected, JSON-safe shapes only.
 */
export const getDepartments = unstable_cache(
  async (): Promise<string[]> => {
    const rows = await db.employee.findMany({
      where: { active: true },
      select: { department: true },
      distinct: ["department"],
      orderBy: { department: "asc" },
    });
    return rows.map((r) => r.department);
  },
  ["departments:active"],
  { tags: [TAG_DEPARTMENTS], revalidate: DEPARTMENTS_TTL },
);
