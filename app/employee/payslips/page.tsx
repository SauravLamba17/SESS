import { Download } from "lucide-react";
import { getEffectiveUserId } from "@/lib/auth";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader, StatCard } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { currentPeriod, financialYearOf } from "@/lib/period";
import { inr, periodLabel } from "@/lib/payroll/format";
import { linkAdjustments, adjustmentLabel } from "@/lib/payroll/adjustments";

export const dynamic = "force-dynamic";

async function load() {
  const userId = await getEffectiveUserId();
  if (!userId) return { employee: null, rows: [], error: null };
  try {
    const employee = await getEmployeeByClerkId(userId);
    if (!employee) return { employee: null, rows: [], error: null };

    // FINALIZED only. An employee must never see a provisional figure
    // presented as their payslip — this is a query-level filter, not a UI one,
    // so there is no view in which a DRAFT or SUBMITTED row reaches them.
    const rows = await db.payroll.findMany({
      where: { employeeId: employee.id, status: "FINALIZED" },
      orderBy: { month: "desc" },
      take: 36,
    });
    return { employee, rows, error: null };
  } catch (err) {
    console.error("[employee/payslips] failed:", err);
    return { employee: null, rows: [], error: "Payslips are unavailable right now." };
  }
}

export default async function MyPayslipsPage() {
  const { employee, rows, error } = await load();

  const latest = rows[0] ?? null;
  const years = Array.from(new Set(rows.map((r) => financialYearOf(r.month))));
  // A correction is shown attached to the payslip it corrects, so the employee
  // sees "July (original) → July (adjustment)", not two unexplained July rows.
  const chains = linkAdjustments(rows);

  return (
    <>
      <PageHeader
        title="Payslips & Financials"
        description="Your finalized payslips and annual Form 16 Part B statement. A payslip appears here once the payroll run for that month has been finalized."
      />

      {error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{error}</span>
        </Panel>
      )}

      {!employee && !error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="warn" />
          <span className="text-sm text-text-muted">
            No employee record is linked to your account yet.
          </span>
        </Panel>
      )}

      {employee && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Latest Net Pay"
              value={latest ? `₹${inr(latest.net.toFixed(2))}` : "—"}
              state={latest ? "good" : "idle"}
              status={latest ? periodLabel(latest.month) : "No finalized payslip yet"}
            />
            <StatCard
              label="Payslips Available"
              value={rows.length}
              state={rows.length > 0 ? "good" : "idle"}
              status="Finalized only"
            />
            <StatCard
              label="Current Period"
              value={periodLabel(currentPeriod().period)}
              state="idle"
              status={`FY ${financialYearOf(currentPeriod().period)}`}
              mono={false}
            />
          </div>

          <Panel>
            <PanelHeader title={`My Payslips · ${rows.length}`} />
            {rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-text-muted">
                No finalized payslips yet. A payslip becomes downloadable only
                after the payroll run for that month has been finalized.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {chains.map(({ original, adjustments }) => {
                  // What the employee actually received for this month, across
                  // the original and every correction to it.
                  const combinedNet =
                    Number(original.net) +
                    adjustments.reduce((sum, a) => sum + Number(a.net), 0);

                  return (
                    <li key={original.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-sm text-text">
                            <StatusDot state="good" />
                            <span>{periodLabel(original.month)}</span>
                            {adjustments.length > 0 && (
                              <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-text-muted">
                                original
                              </span>
                            )}
                            {original.isFinalSettlement && (
                              <span className="rounded border border-warn/40 px-1.5 py-0.5 text-[10px] uppercase text-warn">
                                full &amp; final
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px] text-text-muted">
                            <span>gross ₹{inr(original.gross.toFixed(2))}</span>
                            <span>deductions ₹{inr(original.deductions.toFixed(2))}</span>
                            {Number(original.bonus) > 0 && (
                              <span>bonus ₹{inr(original.bonus.toFixed(2))}</span>
                            )}
                            {Number(original.reimbursements) > 0 && (
                              <span className="text-accent">
                                reimb ₹{inr(original.reimbursements.toFixed(2))}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="font-mono text-sm text-text">
                            ₹{inr(original.net.toFixed(2))}
                          </span>
                          <a
                            href={`/api/payslip/${original.id}`}
                            className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-text hover:bg-surface-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            <Download size={12} /> Download
                          </a>
                        </div>
                      </div>

                      {adjustments.map((a) => (
                        <div
                          key={a.id}
                          className="mt-2 flex items-center justify-between gap-4 border-l-2 border-accent/30 pl-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm text-text">
                              <span className="font-mono text-[10px] uppercase tracking-wide text-accent">
                                ↳ {periodLabel(a.month)} ({adjustmentLabel(a)})
                              </span>
                            </p>
                            <p className="mt-0.5 text-[11px] text-text-muted">
                              {Number(a.net) < 0
                                ? "Correction recovering an overpayment on the payslip above."
                                : "Additional amount paid on top of the payslip above."}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <span
                              className={`font-mono text-sm ${
                                Number(a.net) < 0 ? "text-warn" : "text-good"
                              }`}
                            >
                              {Number(a.net) >= 0 ? "+" : ""}₹{inr(a.net.toFixed(2))}
                            </span>
                            <a
                              href={`/api/payslip/${a.id}`}
                              className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-text hover:bg-surface-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                              <Download size={12} /> Download
                            </a>
                          </div>
                        </div>
                      ))}

                      {adjustments.length > 0 && (
                        <p className="mt-2 border-t border-border pt-2 text-right font-mono text-[11px] text-text-muted">
                          total for {periodLabel(original.month)} after{" "}
                          {adjustments.length} correction
                          {adjustments.length === 1 ? "" : "s"} ·{" "}
                          <span className="text-text">₹{inr(combinedNet.toFixed(2))}</span>
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Form 16 · Part B" />
            <div className="px-4 py-3">
              {years.length === 0 ? (
                <p className="text-sm text-text-muted">
                  Available once you have at least one finalized payroll month.
                </p>
              ) : (
                <>
                  <p className="mb-3 text-sm text-text-muted">
                    An annual statement aggregating your finalized payroll for a
                    financial year (April–March). If a year has fewer than 12
                    finalized months, the statement is clearly labelled as
                    partial — no month is ever estimated.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {years.map((fy) => (
                      <a
                        key={fy}
                        href={`/api/form16?fy=${fy}`}
                        className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <Download size={12} /> FY {fy}
                      </a>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
