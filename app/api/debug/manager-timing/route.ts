import { NextResponse } from "next/server";
import { resolveIdentity } from "@/lib/auth";
import { loadManagerDashboard } from "@/lib/dashboard/manager";
import { loadToday } from "@/lib/engagement/today";
import { collectTimings, timed } from "@/lib/server-timing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TEMPORARY (2026-10-17) — diagnoses the slow /manager warm load. Remove with
 * lib/server-timing.ts and the TEMPORARY middleware block.
 *
 * A Server Component cannot set response headers, so the /manager page itself
 * cannot report its own step timings. This route runs the SAME server work
 * the page does, in the same order — the layout's identity resolution, then
 * the page's Promise.all of loadManagerDashboard() and loadToday() — and
 * returns ONLY a Server-Timing header with each step's duration. The body is
 * empty; no data leaves the server.
 *
 * Signed-in Manager or Super Admin only (the roles that can open /manager).
 */
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  let allowed = false;
  const header = await collectTimings(async () => {
    const id = await timed("resolve-identity", () => resolveIdentity());
    allowed = Boolean(id.userId) && (id.role === "MANAGER" || id.role === "SUPER_ADMIN");
    if (!allowed) return;
    await Promise.all([
      timed("manager-loader", () => loadManagerDashboard(id.userId!)),
      timed("load-today", () => loadToday()),
    ]);
  });
  if (!allowed) return new NextResponse(null, { status: 403, headers: NO_STORE });
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE, "Server-Timing": header } });
}
