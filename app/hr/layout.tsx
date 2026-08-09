import { PortalShell } from "@/components/portal/portal-shell";
import { getCurrentRole } from "@/lib/auth";

export default async function HRLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Role gating for /hr lives in middleware.ts (canAccessPath), as it does for
  // every portal. There is no second-factor check here — MFA enforcement was
  // removed from the codebase entirely.
  const role = await getCurrentRole();
  return (
    <PortalShell portal="hr" role={role}>
      {children}
    </PortalShell>
  );
}
