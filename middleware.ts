import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ROUTE_ACCESS, portalForPath, type Role } from "@/lib/auth-types";

const isPortalRoute = createRouteMatcher([
  "/employee(.*)",
  "/manager(.*)",
  "/hr(.*)",
  "/admin(.*)",
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
  if (!isPortalRoute(req)) return;

  const { userId, sessionClaims, redirectToSignIn } = await auth();

  // Not signed in → send to Clerk sign-in.
  if (!userId) {
    return redirectToSignIn({ returnBackUrl: req.url });
  }

  // Role lives in the session token as `metadata.role`
  // (mirror of the Clerk user's publicMetadata — see README).
  const role = coerceRole(sessionClaims?.metadata?.role);
  const portal = portalForPath(req.nextUrl.pathname);

  // Signed in but role not allowed for this portal → bounce to landing.
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
