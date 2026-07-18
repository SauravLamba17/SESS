import { PortalShell } from "@/components/portal/portal-shell";
import { getCurrentRole } from "@/lib/auth";

export default async function HRLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getCurrentRole();
  return (
    <PortalShell portal="hr" role={role}>
      {children}
    </PortalShell>
  );
}
