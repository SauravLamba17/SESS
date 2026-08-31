import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * READINESS. Public, unauthenticated, and the ONLY health route allowed to
 * touch the database.
 *
 * The check is `SELECT 1` and nothing else. Not a table read, not a count,
 * not a model query — deliberately, because this endpoint is polled by an
 * external monitor and must never itself become a source of load or a slow
 * query during the incident it exists to describe. `SELECT 1` still proves
 * what matters: the pooled connection is live and the server answers.
 *
 * It goes through the shared Prisma singleton in lib/db.ts, never a fresh
 * PrismaClient — a new client per request would open connections against the
 * Supabase pooler ceiling and turn the health check into the outage.
 *
 * FAILURE CONTRACT: 503 with a fixed, generic body. The real error is logged
 * server-side and never serialised into the response — a Prisma connection
 * error message carries the DATABASE_URL host, user and port, and this route
 * is reachable by anyone on the internet.
 *
 * Cache-Control is set by hand on BOTH paths for the reason documented in
 * ../route.ts: force-dynamic emits no such header on its own, and a cached
 * "ready" during an outage is precisely the lie this endpoint exists to
 * prevent. The 503 needs it just as much — a cached 503 after recovery would
 * keep the service out of rotation.
 */
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET() {
  const started = performance.now();
  try {
    await db.$queryRaw`SELECT 1`;
    const responseTimeMs = Math.round(performance.now() - started);

    return NextResponse.json(
      {
        status: "ready",
        service: "SESS",
        checks: { database: "ok" },
        responseTimeMs,
        timestamp: new Date().toISOString(),
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    // Server-side only. Never reaches the caller.
    console.error("[health/ready] database check failed:", err);

    return NextResponse.json(
      {
        status: "not_ready",
        service: "SESS",
        checks: { database: "failed" },
      },
      { status: 503, headers: NO_STORE },
    );
  }
}
