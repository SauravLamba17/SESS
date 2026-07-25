import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal/portal-shell";
import { getCurrentRole } from "@/lib/auth";
import { mfaStatus } from "@/lib/mfa";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // MANDATORY MFA GATE — see app/hr/layout.tsx and lib/mfa.ts.
  const mfa = await mfaStatus();
  if (!mfa.satisfied) redirect("/mfa-required");

  const role = await getCurrentRole();
  return (
    <PortalShell portal="admin" role={role}>
      {children}
    </PortalShell>
  );
}
