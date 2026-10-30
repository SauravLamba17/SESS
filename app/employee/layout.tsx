import { PortalShell } from "@/components/portal/portal-shell";
import { getCurrentRole } from "@/lib/auth";
import { OffboardedBanner } from "@/components/employee/offboarded-banner";

export default async function EmployeeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getCurrentRole();
  return (
    <PortalShell portal="employee" role={role}>
      <OffboardedBanner />
      {children}
    </PortalShell>
  );
}
