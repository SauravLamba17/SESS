import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * LIVENESS. Public, unauthenticated, and deliberately trivial.
 *
 * It answers exactly one question: is this Next.js process up and serving?
 * So it touches NOTHING — no database, no Clerk, no business logic, no
 * env reads. There is no try/catch because there is nothing here that can
 * fail short of the process being down, and that condition is reported by
 * this endpoint NOT RESPONDING, which is the signal a monitor acts on.
 *
 * Readiness — "can it serve real traffic?" — is a separate question with a
 * separate cost, and lives in ./ready/route.ts. Keep them apart: an external
 * monitor polling liveness every few seconds must never generate DB load.
 *
 * Public via the isPublicRoute matcher in middleware.ts, the same mechanism
 * as /careers and /api/webhooks/clerk.
 *
 * Cache-Control is set BY HAND, and that is not belt-and-braces. Verified
 * against a clean production build: `dynamic = "force-dynamic"` alone emits NO
 * Cache-Control header on a route handler — it governs whether Next prerenders,
 * not what the response tells caches. With the header absent, any intermediary
 * is free to heuristically cache the 200, and a monitor would then read a
 * stale "ok" from a process that has since died. force-dynamic stays (it is
 * the codebase's stated convention and keeps this out of the build's static
 * tier); the header is what actually makes the answer current.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "SESS",
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
  );
}
