import { redirect } from "next/navigation";
import { getCurrentRole, getEffectiveUserId } from "@/lib/auth";
import { ROLE_HOME } from "@/lib/auth-types";
import CinematicLanding from "@/components/landing/landing-loader";

/**
 * The public landing page — the ONLY thing at "/", and the only surface in the
 * app that is deliberately outside the theme system (see
 * components/landing/cinematic-landing.module.css).
 *
 * This file stays a Server Component purely for the redirect below; everything
 * visual is code-split behind next/dynamic({ ssr:false }) in landing-loader.tsx.
 */
export default async function LandingPage() {
  const userId = await getEffectiveUserId();

  // Signed in with a role → send to the matching portal, before the marketing
  // page is ever rendered. Unchanged from the previous landing page.
  if (userId) {
    const role = await getCurrentRole();
    if (role) redirect(ROLE_HOME[role]);
  }

  // Reached only by a signed-out visitor, or a signed-in account with no role
  // yet — the latter gets an explanatory line instead of a silent dead end.
  return <CinematicLanding signedInWithoutRole={Boolean(userId)} />;
}
