// Manager reports. The shared body resolves the effective role and renders
// only the reports a Manager may run (team-scoped, plus the department-scoped
// recruitment funnel). The API re-checks every request regardless.
import { ReportsPageBody } from "@/components/reports/reports-page";

export const dynamic = "force-dynamic";

export default function ManagerReports() {
  return <ReportsPageBody />;
}
