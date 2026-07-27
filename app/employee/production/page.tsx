import { getEffectiveUserId } from "@/lib/auth";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { ProductionForm } from "@/components/employee/production-form";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { currentPeriod } from "@/lib/period";
import { timeEfficiency, formatEfficiency } from "@/lib/time-efficiency";
import { ErrorPanel, UnlinkedEmployeeNotice } from "@/components/ui/notice";

export const dynamic = "force-dynamic";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

async function load() {
  const userId = await getEffectiveUserId();
  if (!userId) return { employee: null, error: null };
  try {
    const employee = await getEmployeeByClerkId(userId);
    if (!employee) return { employee: null, error: null };

    const { period, monthStart, monthEnd } = currentPeriod();
    const inMonth = { gte: monthStart, lt: monthEnd };

    const [entries, target, attendance] = await Promise.all([
      db.production.findMany({
        where: { employeeId: employee.id, date: inMonth },
        orderBy: { date: "desc" },
      }),
      db.monthlyTarget.findUnique({
        where: { employeeId_period: { employeeId: employee.id, period } },
      }),
      db.attendance.findMany({
        where: { employeeId: employee.id, date: inMonth },
        select: { date: true, checkIn: true, checkOut: true },
      }),
    ]);

    const attByDate = new Map(attendance.map((a) => [ymd(a.date), a]));
    return { employee, error: null, period, entries, target, attByDate };
  } catch (err) {
    console.error("[employee/production] failed:", err);
    return { employee: null, error: "Production data is unavailable right now." };
  }
}

export default async function MyProductionPage() {
  const data = await load();

  return (
    <>
      <PageHeader
        title="My Production"
        description="Log your daily output. One entry per day — re-logging a date updates it."
      />

      {data.error && (
        <ErrorPanel>{data.error}</ErrorPanel>
      )}

      {!data.employee && !data.error && (
        <UnlinkedEmployeeNotice />
      )}

      {data.employee && (
        <div className="space-y-6">
          <Panel>
            <PanelHeader
              title="Log Production"
              action={
                <span className="font-mono text-xs text-text-muted">
                  {data.period} target:{" "}
                  {data.target ? data.target.targetUnits : "Not set"}
                </span>
              }
            />
            <div className="p-4">
              <ProductionForm minDate={ymd(new Date(data.employee.joiningDate))} />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="This Month's Entries" />
            {data.entries.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <StatusDot state="idle" />
                <p className="text-sm text-text">Nothing logged this month yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Units</th>
                      <th className="px-4 py-3 font-medium">Units / hr</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.entries.map((e) => {
                      const att = data.attByDate.get(ymd(e.date));
                      const eff = timeEfficiency(
                        e.unitsProduced,
                        att?.checkIn ?? null,
                        att?.checkOut ?? null,
                      );
                      return (
                        <tr key={e.id}>
                          <td className="px-4 py-3 font-mono text-text-muted">
                            {ymd(e.date)}
                          </td>
                          <td className="px-4 py-3 font-mono text-text">
                            {e.unitsProduced}
                          </td>
                          <td className="px-4 py-3 font-mono text-text-muted">
                            {formatEfficiency(eff)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
