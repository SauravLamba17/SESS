// Super Admin reports — org-wide scope on all ten. Same shared body as the
// Manager and HR pages; the registry decides what is listed.
import { ReportsPageBody } from "@/components/reports/reports-page";

// Tab title for this route; the root layout appends " · SESS".
export const metadata = { title: "Reports" };

export const dynamic = "force-dynamic";

export default function AdminReports() {
  return <ReportsPageBody />;
}
