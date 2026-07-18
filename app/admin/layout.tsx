import { PortalShell } from "@/components/portal/portal-shell";
import { getCurrentRole } from "@/lib/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getCurrentRole();
  return (
    <PortalShell portal="admin" role={role}>
      {children}
    </PortalShell>
  );
}
