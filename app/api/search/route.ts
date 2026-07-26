import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

/** Per-category cap. Search is a jump-to-record affordance, not a report. */
const LIMIT = 8;

export interface SearchHit {
  kind: "employee" | "candidate" | "requisition";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/**
 * Role-scoped global search.
 *
 * A straightforward `contains` filter — deliberately NOT a search index. At
 * this scale Postgres' ILIKE over a few thousand rows is instant, and a real
 * index (tsvector, Meilisearch) would be infrastructure to maintain for no
 * user-visible gain.
 *
 * SCOPE, enforced server-side per role:
 *   EMPLOYEE    → their own record only. Nothing about anyone else.
 *   MANAGER     → their direct reports (the same single-level rule as
 *                 everywhere else in this codebase), plus themselves.
 *   HR/SUPER_ADMIN → all employees, candidates and job requisitions.
 *
 * Every branch is bounded by `take` — no query here can return unbounded rows.
 *
 * ─── PHASE 13 RE-VERIFICATION: what was deliberately NOT added ───────────
 * Reviewed against everything built since this route: Payroll, Recruitment,
 * Engagement, Reports and Idle Tracking. Only Employee.email was missing (see
 * below). The rest were considered and rejected on purpose:
 *
 *   Payroll        — a payslip has no name to type; you reach it through an
 *                    employee, who IS searchable. Searching "2026-07" would
 *                    return every employee's row for that month, which is a
 *                    report, not a jump-to-record.
 *   Shift, Holiday,
 *   PulseSurvey    — configuration, not records. They live on one page each and
 *                    are reached by navigating there, not by hunting for them.
 *   IdleLog        — deliberately excluded. Making tracking data searchable
 *                    would turn an aggregates-only subsystem into a lookup
 *                    tool, which is exactly the constraint lib/idle/consent.ts
 *                    exists to hold.
 *   Reports        — outputs, not entities.
 *
 * A REDACTED former employee stays findable by name and employeeCode, which is
 * correct: those fields are retained precisely so financial records remain
 * traceable. Their email is null after redaction, so the new email match simply
 * stops finding them by it.
 */
export async function GET(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  // Two characters minimum: a single letter matches most of the org and makes
  // the dropdown useless while scanning every row.
  if (q.length < 2) return NextResponse.json({ ok: true, query: q, hits: [] });
  if (q.length > 100) return fail("BAD_INPUT", "Search term is too long.", 400);

  try {
    const role = await getCurrentRole();
    const like = { contains: q, mode: "insensitive" as const };
    const hits: SearchHit[] = [];

    if (role === "HR" || role === "SUPER_ADMIN") {
      const [employees, candidates, requisitions] = await Promise.all([
        db.employee.findMany({
          // email added in Phase 13's re-verification: it became a first-class
          // Employee field when invitations landed, and HR now onboards people
          // BY email, so not searching it was an inconsistency with the
          // candidate search below (which has always matched on email).
          where: { OR: [{ name: like }, { employeeCode: like }, { email: like }] },
          select: {
            id: true,
            name: true,
            employeeCode: true,
            department: true,
            active: true,
          },
          orderBy: [{ active: "desc" }, { name: "asc" }],
          take: LIMIT,
        }),
        db.candidate.findMany({
          where: { OR: [{ name: like }, { email: like }] },
          select: {
            id: true,
            name: true,
            email: true,
            applications: {
              select: { id: true, stage: true, jobRequisition: { select: { title: true } } },
              orderBy: { updatedAt: "desc" },
              take: 1,
            },
          },
          orderBy: { createdAt: "desc" },
          take: LIMIT,
        }),
        db.jobRequisition.findMany({
          where: { title: like },
          select: { id: true, title: true, department: true, status: true },
          orderBy: [{ status: "asc" }, { createdAt: "desc" }],
          take: LIMIT,
        }),
      ]);

      for (const e of employees)
        hits.push({
          kind: "employee",
          id: e.id,
          title: e.name,
          subtitle: `${e.employeeCode} · ${e.department}${e.active ? "" : " · offboarded"}`,
          href: "/hr/employees",
        });

      for (const c of candidates) {
        const app = c.applications[0];
        hits.push({
          kind: "candidate",
          id: c.id,
          title: c.name,
          subtitle: app
            ? `${c.email} · ${app.jobRequisition.title} · ${app.stage}`
            : `${c.email} · no application`,
          // Deep-link to the application when there is one — that's the page
          // with the resume, feedback and offer on it.
          href: app ? `/hr/candidates/${app.id}` : "/hr/candidates",
        });
      }

      for (const r of requisitions)
        hits.push({
          kind: "requisition",
          id: r.id,
          title: r.title,
          subtitle: `${r.department} · ${r.status}`,
          href: "/hr/requisitions",
        });

      return NextResponse.json({ ok: true, query: q, hits });
    }

    // Everyone below needs their own Employee record to have any scope at all.
    const me = await getEmployeeByClerkId(userId);
    if (!me) return NextResponse.json({ ok: true, query: q, hits: [] });

    if (role === "MANAGER") {
      const team = await db.employee.findMany({
        where: {
          // Direct reports only — the same single-level rule used everywhere.
          // `id: me.id` lets a manager find themselves too.
          OR: [{ managerId: me.id }, { id: me.id }],
          AND: [{ OR: [{ name: like }, { employeeCode: like }] }],
        },
        select: { id: true, name: true, employeeCode: true, department: true },
        orderBy: { name: "asc" },
        take: LIMIT,
      });
      for (const e of team)
        hits.push({
          kind: "employee",
          id: e.id,
          title: e.name,
          subtitle: `${e.employeeCode} · ${e.department}${e.id === me.id ? " · you" : ""}`,
          href: e.id === me.id ? "/employee/profile" : "/manager/attendance",
        });
      return NextResponse.json({ ok: true, query: q, hits });
    }

    // EMPLOYEE — own record only.
    const selfMatches =
      me.name.toLowerCase().includes(q.toLowerCase()) ||
      me.employeeCode.toLowerCase().includes(q.toLowerCase());
    if (selfMatches)
      hits.push({
        kind: "employee",
        id: me.id,
        title: me.name,
        subtitle: `${me.employeeCode} · ${me.department} · you`,
        href: "/employee/profile",
      });

    return NextResponse.json({ ok: true, query: q, hits });
  } catch (err) {
    console.error("[search] failed:", err);
    return fail("SERVER_ERROR", "Search is unavailable right now", 503);
  }
}
