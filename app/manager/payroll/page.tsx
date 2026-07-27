import { getEffectiveUserId } from "@/lib/auth";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { inr, periodLabel, PAYROLL_STATUS_DOT } from "@/lib/payroll/format";
import { ErrorPanel, UnlinkedEmployeeNotice } from "@/components/ui/notice";

export const dynamic = "force-dynamic";

/**
 * Manager payroll — STRICTLY READ-ONLY.
 *
 * There are no edit controls here, and there is no manager-facing payroll
 * write route anywhere in the codebase. Every payroll mutation route
 * (/api/hr/payroll/*, /api/hr/salary-structure, /api/hr/salary-advance,
 * /api/admin/payroll/finalize) checks the EFFECTIVE role and rejects MANAGER
 * with a 403 — so read-only is enforced at the API, not by the absence of
 * buttons on this page.
 */
async function load() {
  const userId = await getEffectiveUserId();
  if (!userId) return { manager: null, rows: [], error: null };
  try {
    const manager = await getEmployeeByClerkId(userId);
    if (!manager) return { manager: null, rows: [], error: null };

    // Scoped at the QUERY level to direct reports only — a manager never sees
    // another team's payroll, regardless of what the UI renders.
    const rows = await db.payroll.findMany({
      where: { employee: { managerId: manager.id } },
      include: {
        employee: { select: { id: true, name: true, employeeCode: true } },
      },
      orderBy: [{ month: "desc" }, { employee: { employeeCode: "asc" } }],
      take: 200,
    });
    return { manager, rows, error: null };
  } catch (err) {
    console.error("[manager/payroll] failed:", err);
    return { manager: null, rows: [], error: "Team payroll is unavailable right now." };
  }
}

export default async function TeamPayrollPage() {
  const { manager, rows, error } = await load();

  const byPeriod = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byPeriod.get(r.month) ?? [];
    arr.push(r);
    byPeriod.set(r.month, arr);
  }

  return (
    <>
      <PageHeader
        title="Team Payroll"
        description="Reference view of payroll for your direct reports. Managers cannot edit payroll — this view is read-only, and the payroll APIs reject manager writes."
      />

      {error && (
        <ErrorPanel>{error}</ErrorPanel>
      )}

      {!manager && !error && (
        <UnlinkedEmployeeNotice />
      )}

      {manager && (
        <div className="space-y-6">
          <Panel className="flex items-center gap-3 px-4 py-3">
            <StatusDot state="idle" />
            <span className="text-sm text-text-muted">
              Read-only. Salary figures are managed by HR and locked by the Super
              Admin — raise any correction with HR rather than here.
            </span>
          </Panel>

          {byPeriod.size === 0 ? (
            <Panel>
              <PanelHeader title="Team Payroll" />
              <div className="px-4 py-10 text-center text-sm text-text-muted">
                No payroll rows for your direct reports yet.
              </div>
            </Panel>
          ) : (
            Array.from(byPeriod.entries()).map(([month, list]) => (
              <Panel key={month}>
                <PanelHeader
                  title={`${periodLabel(month)} · ${list.length} report${list.length === 1 ? "" : "s"}`}
                />
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
                        <th className="px-4 py-3 font-medium">Employee</th>
                        <th className="px-4 py-3 font-medium">Days</th>
                        <th className="px-4 py-3 text-right font-medium">Gross</th>
                        <th className="px-4 py-3 text-right font-medium">Deductions</th>
                        <th className="px-4 py-3 text-right font-medium">Net</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {list.map((r) => (
                        <tr key={r.id} className="hover:bg-surface-raised/50">
                          <td className="px-4 py-3">
                            <span className="text-text">{r.employee.name}</span>
                            <span className="ml-2 font-mono text-xs text-text-muted">
                              {r.employee.employeeCode}
                            </span>
                            {r.isFinalSettlement && (
                              <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-text-muted">
                                F&amp;F
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-text-muted">
                            {r.daysWorked}/{r.daysInMonth}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-text-muted">
                            ₹{inr(r.gross.toFixed(2))}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-text-muted">
                            ₹{inr(r.deductions.toFixed(2))}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-text">
                            ₹{inr(r.net.toFixed(2))}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-2">
                              <StatusDot state={PAYROLL_STATUS_DOT[r.status]} />
                              <span className="text-xs text-text-muted">{r.status}</span>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            ))
          )}
        </div>
      )}
    </>
  );
}
