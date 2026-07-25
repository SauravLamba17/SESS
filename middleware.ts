import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ROUTE_ACCESS, portalForPath, type Role } from "@/lib/auth-types";
import { IMP_COOKIE, verifyImpersonation } from "@/lib/impersonation";

const isPortalRoute = createRouteMatcher([
  "/employee(.*)",
  "/manager(.*)",
  "/hr(.*)",
  "/admin(.*)",
]);

/**
 * Phase 8: the public career surface — the ONLY unauthenticated part of the app.
 *
 * These paths were already outside the gate, because the handler below returns
 * early for anything `isPortalRoute` does not match. Listing them explicitly
 * changes no behaviour today; it exists so the exemption is a stated decision
 * rather than a side effect of how the portal matcher happens to be written.
 * If someone later broadens isPortalRoute, this line documents what must stay
 * reachable — and the assertion in the smoke test will catch a regression.
 *
 * Scope is exact: /careers and the single POST endpoint the form submits to.
 * Resume FILES are NOT public — they are served by
 * app/api/resume/[applicationId]/route.ts, which is role-checked in-route.
 *
 * /api/webhooks/clerk is called by Clerk's servers, not a signed-in user —
 * its trust boundary is svix signature verification in-route, not a session.
 */
const isPublicRoute = createRouteMatcher([
  "/careers(.*)",
  "/api/careers/apply",
  "/api/webhooks/clerk",
]);

/**
 * Phase 9: shared surfaces every signed-in role may use — the community wall
 * and pulse surveys. They require AUTHENTICATION but no particular role, so
 * they are gated alongside the portals below and then fall through the
 * role check, because portalForPath() returns null for them.
 *
 * Listing them here rather than adding them to isPortalRoute keeps the two
 * ideas separate: portals are role-scoped, these are merely signed-in-only.
 */
const isSharedAuthedRoute = createRouteMatcher([
  "/community(.*)",
  "/pulse(.*)",
  // Account/security (where MFA is enabled) and the MFA gate itself: both must
  // require a signed-in user but NO particular role — an HR user who has not
  // set up MFA yet must still be able to reach them, which is exactly why the
  // MFA check lives in the portal layouts and not here.
  "/account(.*)",
  "/mfa-required(.*)",
]);

function coerceRole(value: unknown): Role | null {
  if (
    value === "EMPLOYEE" ||
    value === "MANAGER" ||
    value === "HR" ||
    value === "SUPER_ADMIN"
  ) {
    return value;
  }
  return null;
}

export default clerkMiddleware(async (auth, req) => {
  // Public career surface: never gated, never role-checked.
  if (isPublicRoute(req)) return;

  // Everything else that is not a portal or shared-authed route is likewise
  // ungated here — API routes under /api/** enforce their own auth + role
  // in-route, which is where the 401/403 responses in this codebase come from.
  if (!isPortalRoute(req) && !isSharedAuthedRoute(req)) return;

  const { userId, sessionClaims, redirectToSignIn } = await auth();

  // Not signed in → send to Clerk sign-in.
  if (!userId) {
    return redirectToSignIn({ returnBackUrl: req.url });
  }

  // Real role lives in the session token as `metadata.role`.
  const realRole = coerceRole(sessionClaims?.metadata?.role);

  // Impersonation: ONLY a real Super Admin with a valid, bound cookie takes on
  // an effective role. Same signed-cookie check used everywhere else — the
  // route gate below is identical for genuine and impersonated sessions.
  let role = realRole;
  if (realRole === "SUPER_ADMIN") {
    const imp = await verifyImpersonation(req.cookies.get(IMP_COOKIE)?.value, userId);
    if (imp) role = imp.role;
  }

  const portal = portalForPath(req.nextUrl.pathname);

  // Signed in but (effective) role not allowed for this portal → bounce.
  if (portal && (!role || !ROUTE_ACCESS[portal].includes(role))) {
    return NextResponse.redirect(new URL("/", req.url));
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
