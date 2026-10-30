"use client";

import { cloneElement, type ReactElement } from "react";
import { SignInButton, useAuth, useUser } from "@clerk/nextjs";
import { coerceRole, ROLE_HOME } from "@/lib/auth-types";

/**
 * The landing page's "Sign in" buttons.
 *
 * Signed out → Clerk's sign-in modal, as before. Signed in → go straight to
 * the portal: Clerk refuses to open sign-in over an active session
 * ("cannot_render_single_session_enabled"), so the button used to do nothing.
 * (app/page.tsx already redirects a signed-in user with a role; this covers a
 * page restored from the back/forward cache and a session whose role arrives
 * after the page rendered.)
 *
 * `redirectUrl` is the portal a card points at; without it the user's own
 * portal is used, falling back to "/" where the server redirect decides.
 */
export function SignInOrPortal({
  children,
  redirectUrl,
  signedInLabel,
}: {
  children: ReactElement<{ onClick?: () => void; children?: React.ReactNode }>;
  redirectUrl?: string;
  /** Replaces the button's text when signed in, e.g. "Open my portal". */
  signedInLabel?: string;
}) {
  const { isSignedIn } = useAuth();
  const { user } = useUser();

  if (!isSignedIn)
    return (
      <SignInButton mode="modal" {...(redirectUrl ? { forceRedirectUrl: redirectUrl } : {})}>
        {children}
      </SignInButton>
    );

  const role = coerceRole(user?.publicMetadata?.role);
  const target = redirectUrl ?? (role ? ROLE_HOME[role] : "/");
  return cloneElement(children, {
    onClick: () => window.location.assign(target),
    ...(signedInLabel ? { children: signedInLabel } : {}),
  });
}
