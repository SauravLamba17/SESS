import { getEffectiveUserId } from "@/lib/auth";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel } from "@/components/ui/panel";
import { TargetInput } from "@/components/manager/target-input";
import { ShiftAssignSelect } from "@/components/shifts/shift-assign-select";
import { db } from "@/lib/db";
import { getEmployeeByClerkId, getDirectReports } from "@/lib/data/scope";
import { getActiveShiftOptions } from "@/lib/cache/shifts";
import { currentPeriod } from "@/lib/period";
import { timeEfficiency, formatEfficiency } from "@/lib/time-efficiency";
import { ErrorPanel, UnlinkedEmployeeNotice } from "@/components/ui/notice";
import { ymd } from "@/lib/reports/range";

export const dynamic = "force-dynamic";

async function load() {
  const userId = await getEffectiveUserId();
  if (!userId) return { manager: null, error: null };
  try {
    const manager = await getEmployeeByClerkId(userId);
    if (!manager) return { manager: null, error: null };

    const { period, monthStart, monthEnd } = currentPeriod();
    const reports = await getDirectReports(manager.id);
    const ids = reports.map((r) => r.id);
    const inMonth = { gte: monthStart, lt: monthEnd };

    // Set-based queries, all keyed on employeeId IN (...) — independent of team size.
    const [actuals, targets, daily, attendance, shifts] = await Promise.all([
      db.production.groupBy({
        by: ["employeeId"],
        where: { employeeId: { in: ids }, date: inMonth },
        _sum: { unitsProduced: true },
      }),
      db.monthlyTarget.findMany({ where: { period, employeeId: { in: ids } } }),
      db.production.findMany({
        where: { employeeId: { in: ids }, date: inMonth },
        select: { employeeId: true, date: true, unitsProduced: true },
        orderBy: { date: "desc" },
      }),
      db.attendance.findMany({
        where: { employeeId: { in: ids }, date: inMonth },
        select: { employeeId: true, date: true, checkIn: true, checkOut: true },
      }),
      // GREEN TIER (§2/§4) — shift definitions, 1 hr, tag-invalidated.
      getActiveShiftOptions(),
    ]);

    const actualByEmp = new Map(actuals.map((a) => [a.employeeId, a._sum.unitsProduced ?? 0]));
    const targetByEmp = new Map(targets.map((t) => [t.employeeId, t.targetUnits]));

    const dailyByEmp = new Map<string, typeof daily>();
    for (const d of daily) {
      const arr = dailyByEmp.get(d.employeeId) ?? [];
      arr.push(d);
      dailyByEmp.set(d.employeeId, arr);
    }
    // Attendance keyed by employeeId|date for efficiency lookup.
    const attByKey = new Map(attendance.map((a) => [`${a.employeeId}|${ymd(a.date)}`, a]));

    const shiftOptions = shifts.map((s) => ({ id: s.id, name: s.name }));
    return { manager, error: null, period, reports, actualByEmp, targetByEmp, dailyByEmp, attByKey, shiftOptions };
  } catch (err) {
    console.error("[manager/production] failed:", err);
    return { manager: null, error: "Production data is unavailable right now." };
  }
}

export default async function ProductionTargetsPage() {
  const data = await load();

  return (
    <>
      <PageHeader
        title="Production & Targets"
        description="Set this month's target and track actual output for your direct reports."
      />

      {data.error && (
        <ErrorPanel>{data.error}</ErrorPanel>
      )}

      {!data.manager && !data.error && (
        <UnlinkedEmployeeNotice />
      )}

      {data.manager && (
        <Panel>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-text">Direct Reports</h3>
            <span className="font-mono text-xs text-text-muted">{data.period}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Actual (MTD)</th>
                  <th className="px-4 py-3 font-medium">Target</th>
                  <th className="px-4 py-3 text-right font-medium">Set / Update</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.reports.map((r) => {
                  const actual = data.actualByEmp.get(r.id) ?? 0;
                  const target = data.targetByEmp.get(r.id) ?? null;
                  const days = data.dailyByEmp.get(r.id) ?? [];
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="px-4 py-3" colSpan={4}>
                        <div className="grid grid-cols-4 items-center gap-2">
                          <div>
                            <div className="text-text">{r.name}</div>
                            <div className="font-mono text-xs text-text-muted">
                              {r.employeeCode}
                            </div>
                          </div>
                          <div className="font-mono text-text">{actual}</div>
                          <div className="font-mono">
                            {target === null ? (
                              <span className="text-text-muted">Not set</span>
                            ) : (
                              <span className="text-text">{target}</span>
                            )}
                          </div>
                          <div className="flex justify-end">
                            <TargetInput employeeId={r.id} current={target} />
                          </div>
                        </div>

                        {/* Shift (display + reassign a direct report) */}
                        <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
                          <span>
                            Shift:{" "}
                            <span className="font-mono text-text">
                              {r.shift ? `${r.shift.name} (${r.shift.startTime}–${r.shift.endTime})` : "—"}
                            </span>
                          </span>
                          <ShiftAssignSelect
                            employeeId={r.id}
                            currentShiftId={r.shiftId}
                            shifts={data.shiftOptions}
                            endpoint="/api/manager/shift"
                          />
                        </div>

                        {/* Per-employee daily breakdown (native disclosure) */}
                        <details className="mt-2 rounded border border-border bg-surface-raised/40">
                          <summary className="cursor-pointer px-3 py-1.5 text-xs text-text-muted">
                            {days.length} daily {days.length === 1 ? "entry" : "entries"} this month
                          </summary>
                          {days.length > 0 && (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-t border-border text-left text-text-muted">
                                  <th className="px-3 py-1.5 font-medium">Date</th>
                                  <th className="px-3 py-1.5 font-medium">Units</th>
                                  <th className="px-3 py-1.5 font-medium">Units / hr</th>
                                </tr>
                              </thead>
                              <tbody>
                                {days.map((d) => {
                                  const att = data.attByKey.get(`${r.id}|${ymd(d.date)}`);
                                  const eff = timeEfficiency(
                                    d.unitsProduced,
                                    att?.checkIn ?? null,
                                    att?.checkOut ?? null,
                                  );
                                  return (
                                    <tr key={ymd(d.date)} className="border-t border-border/60">
                                      <td className="px-3 py-1.5 font-mono text-text-muted">
                                        {ymd(d.date)}
                                      </td>
                                      <td className="px-3 py-1.5 font-mono text-text">
                                        {d.unitsProduced}
                                      </td>
                                      <td className="px-3 py-1.5 font-mono text-text-muted">
                                        {formatEfficiency(eff)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </details>
                      </td>
                    </tr>
                  );
                })}
                {data.reports.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-text-muted">
                      No direct reports.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
