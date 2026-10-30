"use client";

import { useEffect } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { coerceRole, ROLE_HOME } from "@/lib/auth-types";

/**
 * The moment a visitor on the landing page is signed in with a role, cover the
 * marketing page and go straight to their portal.
 *
 * Without this, signing in from the modal left the landing page — still
 * showing "Sign in" — on screen until Clerk's own navigation reached "/" and
 * the server redirect (app/page.tsx) ran. That gap looked like a failed
 * sign-in (and in dev, while a portal route compiled, it lasted 10–15 s).
 *
 * The role is the same Clerk metadata the server reads (lib/auth.ts). No role
 * → render nothing: the page's own "no role assigned yet" notice applies, and
 * there is nowhere to send them.
 */
export function SignedInRedirect() {
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const role = isSignedIn ? coerceRole(user?.publicMetadata?.role) : null;

  useEffect(() => {
    if (role) window.location.replace(ROLE_HOME[role]);
  }, [role]);

  if (!role) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#05070A",
        color: "#E6EDF3",
        font: "500 15px/1.4 system-ui, sans-serif",
        letterSpacing: "0.02em",
      }}
    >
      Signed in. Opening your portal…
    </div>
  );
}
