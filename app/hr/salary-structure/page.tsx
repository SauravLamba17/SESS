import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { SalaryStructureForm } from "@/components/hr/salary-structure-form";
import { SalaryAdvanceForm } from "@/components/hr/salary-advance-form";
import { db } from "@/lib/db";
import { inr } from "@/lib/payroll/format";
import { buildSalaryTimeline } from "@/lib/payroll/salary-history";
import { ErrorPanel } from "@/components/ui/notice";
import { ymd } from "@/lib/reports/range";

export const dynamic = "force-dynamic";

/**
 * RED TIER — never cache, see SESS_Caching_Strategy.docx Section 3.
 *
 * Employee salary and salary-structure history. Read directly on every
 * render — see the note in app/api/hr/salary-structure/route.ts for why no
 * cached VIEW of this data exists to be invalidated.
 */

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
        // Phase 13: superseded versions, joined in the same query — still one
        // round trip for the page, no per-employee history lookup.
        salaryHistory: {
          orderBy: { effectiveFrom: "asc" },
        },
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
        <ErrorPanel>{error}</ErrorPanel>
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
                            eff. {ymd(s.effectiveFrom)}
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
                                effectiveFrom: ymd(s.effectiveFrom),
                              }
                            : null
                        }
                      />
                    </div>
                  </details>

                  {/* Phase 13: the full effective-dated timeline, current
                      version included. Only rendered when there is history —
                      a first structure has nothing to compare against. */}
                  {e.salaryHistory.length > 0 && (
                    <details className="mt-2 rounded border border-border bg-surface-raised/40">
                      <summary className="cursor-pointer px-3 py-1.5 text-xs text-text-muted">
                        Salary history · {e.salaryHistory.length + (s ? 1 : 0)} version
                        {e.salaryHistory.length + (s ? 1 : 0) === 1 ? "" : "s"}
                      </summary>
                      <div className="overflow-x-auto p-3">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-text-muted">
                              <th className="py-1.5 pr-3 font-medium">Ver</th>
                              <th className="py-1.5 pr-3 font-medium">Effective</th>
                              <th className="py-1.5 pr-3 text-right font-medium">Basic</th>
                              <th className="py-1.5 pr-3 text-right font-medium">HRA</th>
                              <th className="py-1.5 pr-3 text-right font-medium">Special</th>
                              <th className="py-1.5 pr-3 text-right font-medium">Gross</th>
                              <th className="py-1.5 text-right font-medium">Change</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {buildSalaryTimeline(
                              s
                                ? {
                                    basic: s.basic.toFixed(2),
                                    hra: s.hra.toFixed(2),
                                    specialAllowance: s.specialAllowance.toFixed(2),
                                    effectiveFrom: s.effectiveFrom,
                                    setBy: s.setBy,
                                  }
                                : null,
                              e.salaryHistory.map((h) => ({
                                basic: h.basic.toFixed(2),
                                hra: h.hra.toFixed(2),
                                specialAllowance: h.specialAllowance.toFixed(2),
                                effectiveFrom: h.effectiveFrom,
                                effectiveTo: h.effectiveTo,
                                versionNumber: h.versionNumber,
                                setBy: h.setBy,
                                supersededBy: h.supersededBy,
                                supersededAt: h.supersededAt,
                              })),
                            ).map((v) => (
                              <tr key={v.versionNumber} className={v.current ? "text-text" : "text-text-muted"}>
                                <td className="py-1.5 pr-3 font-mono">
                                  v{v.versionNumber}
                                  {v.current && (
                                    <span className="ml-1 text-[9px] uppercase text-good">current</span>
                                  )}
                                </td>
                                <td className="py-1.5 pr-3 font-mono">
                                  {ymd(v.effectiveFrom)} →{" "}
                                  {v.effectiveTo ? ymd(v.effectiveTo) : "present"}
                                </td>
                                <td className="py-1.5 pr-3 text-right font-mono">{inr(v.basic)}</td>
                                <td className="py-1.5 pr-3 text-right font-mono">{inr(v.hra)}</td>
                                <td className="py-1.5 pr-3 text-right font-mono">
                                  {inr(v.specialAllowance)}
                                </td>
                                <td className="py-1.5 pr-3 text-right font-mono text-text">
                                  {inr(v.gross)}
                                </td>
                                <td
                                  className={`py-1.5 text-right font-mono ${
                                    v.grossDelta === null
                                      ? ""
                                      : v.grossDelta.startsWith("-")
                                        ? "text-danger"
                                        : "text-good"
                                  }`}
                                >
                                  {v.grossDelta === null
                                    ? "—"
                                    : `${v.grossDelta.startsWith("-") ? "" : "+"}${inr(v.grossDelta)}`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="mt-2 text-[10px] text-text-muted">
                          Ranges are half-open: a version ends on the day the next
                          takes effect. Finalized payslips are unaffected by any
                          later change — they snapshot the figures at run time.
                        </p>
                      </div>
                    </details>
                  )}

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
          One current structure per employee. Saving no longer discards the old
          one: the version being replaced is archived with its effective range
          closed, and the full timeline appears under &quot;Salary history&quot;
          above. The new structure must take effect after the current one — to
          fix a typo in the version in force, correct its effective date rather
          than recording a change that never happened. Payroll rows snapshot
          Basic/HRA/Special Allowance at run time, so finalized payslips are
          unaffected by any later structure change.
        </p>
      </Panel>
    </>
  );
}
