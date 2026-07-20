import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { SalaryStructureForm } from "@/components/hr/salary-structure-form";
import { SalaryAdvanceForm } from "@/components/hr/salary-advance-form";
import { db } from "@/lib/db";
import { inr } from "@/lib/payroll/format";

export const dynamic = "force-dynamic";

async function load() {
  try {
    // One query — structures come in via the relation, no per-employee lookup.
    const employees = await db.employee.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        employeeCode: true,
        department: true,
        designation: true,
        pfUan: true,
        salaryStructure: true,
        // Active advance joined in — no per-employee lookup.
        salaryAdvances: {
          where: { status: "ACTIVE" },
          select: {
            principalAmount: true,
            monthlyDeduction: true,
            remainingBalance: true,
          },
          orderBy: { issuedAt: "asc" },
          take: 1,
        },
      },
      orderBy: [{ department: "asc" }, { employeeCode: "asc" }],
    });
    return { employees, error: null };
  } catch (err) {
    console.error("[hr/salary-structure] failed:", err);
    return { employees: [], error: "Salary structures are unavailable right now." };
  }
}

export default async function SalaryStructurePage() {
  const { employees, error } = await load();
  const withStructure = employees.filter((e) => e.salaryStructure).length;
  const missing = employees.length - withStructure;

  return (
    <>
      <PageHeader
        title="Salary Structure"
        description="Set each employee's monthly salary breakup. A payroll run only picks up employees who have a structure — everyone else is reported as unpayable rather than given a zeroed row."
      />

      {error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{error}</span>
        </Panel>
      )}

      <Panel className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
        <span className="inline-flex items-center gap-2">
          <StatusDot state="good" />
          <span className="text-text-muted">
            {withStructure} of {employees.length} active employees have a structure
          </span>
        </span>
        {missing > 0 && (
          <span className="inline-flex items-center gap-2">
            <StatusDot state="warn" />
            <span className="text-text-muted">{missing} not yet set</span>
          </span>
        )}
      </Panel>

      <Panel>
        <PanelHeader title={`Active Employees · ${employees.length}`} />
        {employees.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-text-muted">
            No active employees.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {employees.map((e) => {
              const s = e.salaryStructure;
              return (
                <li key={e.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm text-text">
                        <StatusDot state={s ? "good" : "warn"} />
                        <span>{e.name}</span>
                        <span className="font-mono text-xs text-text-muted">
                          {e.employeeCode}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-text-muted">
                        {e.department}
                        {e.designation ? ` · ${e.designation}` : ""}
                        {e.pfUan ? ` · UAN ${e.pfUan}` : " · no UAN"}
                        {e.salaryAdvances[0] && (
                          <span className="text-warn">
                            {" "}
                            · advance ₹
                            {inr(e.salaryAdvances[0].remainingBalance.toFixed(2))} due
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {s ? (
                        <>
                          <div className="font-mono text-sm text-text">
                            ₹
                            {inr(
                              s.basic
                                .plus(s.hra)
                                .plus(s.specialAllowance)
                                .toFixed(2),
                            )}
                          </div>
                          <div className="font-mono text-[11px] text-text-muted">
                            eff. {s.effectiveFrom.toISOString().slice(0, 10)}
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-warn">no structure set</span>
                      )}
                    </div>
                  </div>

                  <details className="mt-2 rounded border border-border bg-surface-raised/40">
                    <summary className="cursor-pointer px-3 py-1.5 text-xs text-text-muted">
                      {s ? "Edit structure" : "Set structure"}
                    </summary>
                    <div className="p-3">
                      <SalaryStructureForm
                        employeeId={e.id}
                        initialPfUan={e.pfUan}
                        initial={
                          s
                            ? {
                                basic: s.basic.toFixed(2),
                                hra: s.hra.toFixed(2),
                                specialAllowance: s.specialAllowance.toFixed(2),
                                effectiveFrom: s.effectiveFrom
                                  .toISOString()
                                  .slice(0, 10),
                              }
                            : null
                        }
                      />
                    </div>
                  </details>

                  <details className="mt-2 rounded border border-border bg-surface-raised/40">
                    <summary className="cursor-pointer px-3 py-1.5 text-xs text-text-muted">
                      Salary advance
                    </summary>
                    <div className="p-3">
                      <SalaryAdvanceForm
                        employeeId={e.id}
                        activeAdvance={
                          e.salaryAdvances[0]
                            ? {
                                principalAmount:
                                  e.salaryAdvances[0].principalAmount.toFixed(2),
                                monthlyDeduction:
                                  e.salaryAdvances[0].monthlyDeduction.toFixed(2),
                                remainingBalance:
                                  e.salaryAdvances[0].remainingBalance.toFixed(2),
                              }
                            : null
                        }
                      />
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
        <p className="border-t border-border px-4 py-3 text-xs text-text-muted">
          One current structure per employee — saving replaces the previous one.
          Historical structures (so a mid-year raise leaves an auditable trail of
          what was in force when) are a clean future addition: add an
          effective-dated table and select by period at run creation. Payroll
          rows already snapshot Basic/HRA/Special Allowance at run time, so
          finalized payslips are unaffected by a later structure change.
        </p>
      </Panel>
    </>
  );
}
