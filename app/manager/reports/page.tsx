// Manager reports. The shared body resolves the effective role and renders
// only the reports a Manager may run (team-scoped, plus the department-scoped
// recruitment funnel). The API re-checks every request regardless.
import { ReportsPageBody } from "@/components/reports/reports-page";

// Tab title for this route; the root layout appends " · SESS".
export const metadata = { title: "Reports" };

export const dynamic = "force-dynamic";

export default function ManagerReports() {
  return <ReportsPageBody />;
}
