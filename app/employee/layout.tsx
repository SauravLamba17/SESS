import { PortalShell } from "@/components/portal/portal-shell";
import { getCurrentRole } from "@/lib/auth";

export default async function EmployeeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getCurrentRole();
  return (
    <PortalShell portal="employee" role={role}>
      {children}
    </PortalShell>
  );
}
