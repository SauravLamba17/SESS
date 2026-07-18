import { PortalShell } from "@/components/portal/portal-shell";
import { getCurrentRole } from "@/lib/auth";

export default async function ManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getCurrentRole();
  return (
    <PortalShell portal="manager" role={role}>
      {children}
    </PortalShell>
  );
}
