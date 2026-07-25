import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal/portal-shell";
import { getCurrentRole } from "@/lib/auth";
import { mfaStatus } from "@/lib/mfa";

export default async function HRLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // MANDATORY MFA GATE. Runs before any HR page renders, so every route under
  // /hr is covered by this one check rather than each page repeating it.
  // See lib/mfa.ts for why this is a layout and not middleware.
  const mfa = await mfaStatus();
  if (!mfa.satisfied) redirect("/mfa-required");

  const role = await getCurrentRole();
  return (
    <PortalShell portal="hr" role={role}>
      {children}
    </PortalShell>
  );
}
