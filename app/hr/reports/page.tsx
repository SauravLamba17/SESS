// HR reports — org-wide scope on all ten. Same shared body as the Manager and
// Super Admin pages; the registry decides what is listed.
import { ReportsPageBody } from "@/components/reports/reports-page";

export const dynamic = "force-dynamic";

export default function HrReports() {
  return <ReportsPageBody />;
}
