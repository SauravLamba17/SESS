import { ModuleStub } from "@/components/portal/module-stub";

export default function HRPayroll() {
  return (
    <ModuleStub
      title="Payroll & Financials"
      description="Edit and submit payroll. Finalizing/locking is a Super Admin action."
      scope="Edit + submit (org-wide) · cannot finalize"
    />
  );
}
