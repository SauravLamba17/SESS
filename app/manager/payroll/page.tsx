import { ModuleStub } from "@/components/portal/module-stub";

export default function TeamPayroll() {
  return (
    <ModuleStub
      title="Team Payroll"
      description="Reference view of payroll for your direct reports. Managers cannot edit payroll."
      scope="View-only (direct reports only)"
    />
  );
}
