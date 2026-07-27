import Link from "next/link";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader, StatCard } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { PayrollRunActions } from "@/components/hr/payroll-run-actions";
import { PayrollRowEditor } from "@/components/hr/payroll-row-editor";
import { CreateAdjustmentButton } from "@/components/hr/create-adjustment-button";
import { PrintButton } from "@/components/ui/print-button";
import { db } from "@/lib/db";
import { currentPeriod, isPeriod, financialYearOf } from "@/lib/period";
import { inr, periodLabel, PAYROLL_STATUS_DOT } from "@/lib/payroll/format";
import { linkAdjustments, adjustmentLabel } from "@/lib/payroll/adjustments";
import { ErrorPanel } from "@/components/ui/notice";

export const dynamic = "force-dynamic";

async function load(period: string) {
  try {
    // Two queries for the whole run — rows (with employee joined) and the set
    // of active employees still missing a salary structure. No per-row lookups.
    const [rows, unpayable] = await Promise.all([
      db.payroll.findMany({
        where: { month: period },
        include: {
          employee: {
            select: { id: true, name: true, employeeCode: true, department: true },
          },
        },
        orderBy: { employee: { employeeCode: "asc" } },
      }),
      db.employee.findMany({
        where: { active: true, salaryStructure: { is: null } },
        select: { id: true, name: true, employeeCode: true },
        orderBy: { employeeCode: "asc" },
      }),
    ]);
    return { rows, unpayable, error: null };
  } catch (err) {
    console.error("[hr/payroll] failed:", err);
    return { rows: [], unpayable: [], error: "Payroll data is unavailable right now." };
  }
}

type LoadedRow = Awaited<ReturnType<typeof load>>["rows"][number];

/**
 * One payroll row. Shared by originals and their adjustments so a correction
 * is displayed with the same breakdown as the row it corrects.
 */
function PayrollRowBlock({
  r,
  nested = false,
}: {
  r: LoadedRow;
  nested?: boolean;
}) {
  const isAdjustment = r.adjustmentForPayrollId !== null;
  const sign = (d: { toFixed: (n: number) => string }) =>
    isAdjustment && !d.toFixed(2).startsWith("-") && Number(d.toFixed(2)) !== 0
      ? `+${inr(d.toFixed(2))}`
      : inr(d.toFixed(2));

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm text-text">
            <StatusDot state={PAYROLL_STATUS_DOT[r.status]} />
            {!nested && <span>{r.employee.name}</span>}
            {!nested && (
              <span className="font-mono text-xs text-text-muted">
                {r.employee.employeeCode}
              </span>
            )}
            {/* The bare word "DRAFT" did not tell anyone the row still needs
                an explicit Submit. Say what the state MEANS, not just its name. */}
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                r.status === "DRAFT"
                  ? "border-warn/50 bg-warn/10 text-warn"
                  : r.status === "SUBMITTED"
                    ? "border-accent/50 bg-accent/10 text-accent"
                    : "border-good/50 bg-good/10 text-good"
              }`}
            >
              {r.status === "DRAFT"
                ? "Draft — not yet submitted"
                : r.status === "SUBMITTED"
                  ? "Submitted — awaiting Super Admin"
                  : "Finalized — locked"}
            </span>
            {r.isFinalSettlement && (
              <span className="rounded border border-warn/40 px-1.5 py-0.5 text-[10px] uppercase text-warn">
                full &amp; final
              </span>
            )}
            {isAdjustment && (
              <span className="rounded border border-accent/40 px-1.5 py-0.5 text-[10px] uppercase text-accent">
                adjustment · delta
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px] text-text-muted">
            {/* Days are meaningless on a delta row — it pays a difference,
                not a number of days. */}
            {!isAdjustment && (
              <span className={r.daysWorked < r.daysInMonth ? "text-warn" : undefined}>
                {r.daysWorked}/{r.daysInMonth} days
              </span>
            )}
            <span>gross {sign(r.gross)}</span>
            <span>ded {sign(r.deductions)}</span>
            {Number(r.loanDeduction) > 0 && (
              <span className="text-warn">loan ₹{inr(r.loanDeduction.toFixed(2))}</span>
            )}
            {Number(r.reimbursements) > 0 && (
              <span className="text-accent">
                reimb ₹{inr(r.reimbursements.toFixed(2))}
              </span>
            )}
            {r.tdsSource && <span>tds src: {r.tdsSource}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-sm text-text">{sign(r.net)}</span>
          {r.status === "FINALIZED" && (
            <a
              href={`/api/payslip/${r.id}`}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-muted hover:bg-surface-raised"
            >
              <Download size={12} /> Payslip
            </a>
          )}
        </div>
      </div>

      {r.status === "DRAFT" ? (
        <details className="mt-2 rounded border border-border bg-surface-raised/40">
          <summary className="cursor-pointer px-3 py-1.5 text-xs text-text-muted">
            {isAdjustment
              ? "Edit adjustment — additional amounts"
              : "Edit deductions, TDS & bonus"}
          </summary>
          <div className="p-3">
            <PayrollRowEditor
              row={{
                id: r.id,
                pfEmployee: r.pfEmployee.toFixed(2),
                pfEmployer: r.pfEmployer.toFixed(2),
                esi: r.esi.toFixed(2),
                professionalTax: r.professionalTax.toFixed(2),
                tds: r.tds.toFixed(2),
                tdsSource: r.tdsSource,
                bonus: r.bonus.toFixed(2),
                basic: r.basic.toFixed(2),
                hra: r.hra.toFixed(2),
                specialAllowance: r.specialAllowance.toFixed(2),
                reimbursements: r.reimbursements.toFixed(2),
                loanDeduction: r.loanDeduction.toFixed(2),
                adjustmentFor: isAdjustment
                  ? { period: periodLabel(r.month), finalizedAt: null }
                  : null,
              }}
            />
          </div>
        </details>
      ) : (
        <div className="mt-1.5 flex items-start justify-between gap-3">
          <p className="text-[11px] text-text-muted">
            {r.status === "SUBMITTED"
              ? "Locked for editing — awaiting Super Admin finalization."
              : "Finalized and immutable. Corrections are issued as a separate adjustment record."}
          </p>
          {/* No edit control on a FINALIZED row — by design. The only action
              is raising a new, separately-approved correction. */}
          {r.status === "FINALIZED" && (
            <CreateAdjustmentButton payrollId={r.id} period={periodLabel(r.month)} />
          )}
        </div>
      )}
    </>
  );
}

export default async function HRPayrollPage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const period = isPeriod(searchParams.period)
    ? searchParams.period.trim()
    : currentPeriod().period;

  const { rows, unpayable, error } = await load(period);

  const drafts = rows.filter((r) => r.status === "DRAFT").length;
  const submitted = rows.filter((r) => r.status === "SUBMITTED").length;
  const finalized = rows.filter((r) => r.status === "FINALIZED").length;
  const totalNet = rows.reduce((n, r) => n + Number(r.net), 0);
  // A settlement or adjustment row shares the month with the regular run and
  // must not make the period look "already run" — mirrors the same filter the
  // run route applies server-side.
  const regularRows = rows.filter(
    (r) => !r.isFinalSettlement && r.adjustmentForPayrollId === null,
  ).length;
  // Corrections render nested under the row they correct, not as loose rows.
  const chains = linkAdjustments(rows);

  return (
    <>
      <PageHeader
        title="Payroll & Financials"
        description="Create and edit the monthly run, then submit it. Finalizing is a Super Admin action — once finalized, no figure can be changed through any code path."
        action={<PrintButton label="Print run" />}
      />

      {error && (
        <ErrorPanel>{error}</ErrorPanel>
      )}

      {/* Native month input + GET form — no client state needed to pick a period. */}
      <Panel className="mb-5 p-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="period"
              className="mb-1 block text-xs uppercase tracking-wide text-text-muted"
            >
              Pay period
            </label>
            <input
              id="period"
              name="period"
              type="month"
              defaultValue={period}
              className="rounded border border-border bg-background px-3 py-2 font-mono text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
          <button
            type="submit"
            className="rounded border border-border px-3 py-2 text-xs text-text hover:bg-surface-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Load period
          </button>
          <div className="ml-auto">
            <PayrollRunActions
              period={period}
              canCreate={regularRows === 0}
              canSubmit={drafts > 0}
              createDisabledReason={
                regularRows === 0
                  ? undefined
                  : `A run for ${periodLabel(period)} already exists — ${rows.length} row${rows.length === 1 ? "" : "s"} below.`
              }
              submitDisabledReason={
                drafts > 0
                  ? undefined
                  : rows.length === 0
                    ? "Nothing to submit yet — run Step 1 first to create this period's draft rows."
                    : submitted > 0
                      ? `Already submitted — ${submitted} row${submitted === 1 ? "" : "s"} awaiting Super Admin finalization.`
                      : "No draft rows left to submit for this period."
              }
            />
          </div>
        </form>
      </Panel>

      {/* Where this period actually stands. Setting a salary structure is NOT
          creating payroll — that confusion is exactly what this banner exists
          to prevent. */}
      <Panel className="mb-5 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <StatusDot state={rows.length === 0 ? "idle" : drafts > 0 ? "warn" : "good"} />
          <span className="font-medium text-text">{periodLabel(period)}:</span>
          {rows.length === 0 ? (
            <span className="text-text-muted">
              No payroll run exists yet. Nothing has been created for this period
              — start with <span className="text-accent">Step 1 · Create payroll run</span> above.
            </span>
          ) : drafts > 0 ? (
            <span className="text-warn">
              {drafts} draft row{drafts === 1 ? "" : "s"} created but{" "}
              <span className="font-medium">not yet submitted</span>. The Super
              Admin cannot see these until you run{" "}
              <span className="text-accent">Step 2 · Submit run for approval</span>.
            </span>
          ) : submitted > 0 ? (
            <span className="text-text-muted">
              {submitted} row{submitted === 1 ? "" : "s"} submitted and awaiting
              Super Admin finalization. They now appear on the Super Admin&apos;s
              Payroll Finalization page.
            </span>
          ) : (
            <span className="text-text-muted">
              {finalized} row{finalized === 1 ? "" : "s"} finalized and locked.
            </span>
          )}
        </div>
      </Panel>

      {/* Single column at 375px — two stat cards side by side truncated their
          money values; two up from sm, four from xl as before. */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={`Rows · ${periodLabel(period)}`}
          value={rows.length}
          state={rows.length > 0 ? "good" : "idle"}
          status={rows.length === 0 ? "No run created" : `${finalized} finalized`}
        />
        <StatCard
          label="Draft"
          value={drafts}
          state={drafts > 0 ? "warn" : "idle"}
          status={drafts > 0 ? "Editable by HR" : "None"}
        />
        <StatCard
          label="Submitted"
          value={submitted}
          state={submitted > 0 ? "warn" : "idle"}
          status={submitted > 0 ? "Awaiting Super Admin" : "None"}
        />
        <StatCard
          label="Total Net"
          value={`₹${inr(totalNet.toFixed(2))}`}
          state="good"
          status={`FY ${financialYearOf(period)}`}
          mono
        />
      </div>

      {unpayable.length > 0 && (
        <Panel className="mb-5">
          <PanelHeader title={`Cannot Run Payroll · ${unpayable.length}`} />
          <div className="px-4 py-3">
            <div className="mb-2 flex items-center gap-2 text-sm text-warn">
              <StatusDot state="warn" />
              <span>No salary structure set — these employees are skipped by every run.</span>
            </div>
            <ul className="flex flex-wrap gap-2">
              {unpayable.map((e) => (
                <li
                  key={e.id}
                  className="rounded border border-border bg-surface-raised px-2 py-1 font-mono text-[11px] text-text-muted"
                >
                  {e.name} · {e.employeeCode}
                </li>
              ))}
            </ul>
            <Link
              href="/hr/salary-structure"
              className="mt-3 inline-block text-xs text-accent underline"
            >
              Set salary structures →
            </Link>
          </div>
        </Panel>
      )}

      <Panel>
        <PanelHeader title={`Payroll Run · ${periodLabel(period)}`} />
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-text-muted">
            No payroll run exists for {periodLabel(period)} — create one above.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {chains.map(({ original, adjustments }) => (
              <li key={original.id} className="px-4 py-3">
                <PayrollRowBlock r={original} />

                {adjustments.length > 0 && (
                  <div className="mt-2 space-y-2 border-l-2 border-accent/30 pl-3">
                    {adjustments.map((a) => (
                      <div key={a.id}>
                        <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-accent">
                          ↳ {periodLabel(a.month)} ({adjustmentLabel(a)})
                        </p>
                        <PayrollRowBlock r={a} nested />
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="mt-5">
        <PanelHeader title="Form 16 · Part B" />
        <div className="px-4 py-3 text-sm">
          <p className="text-text-muted">
            Generated by aggregating an employee&apos;s FINALIZED payroll across a
            financial year (April–March). SESS formats and totals figures HR has
            already recorded — it computes no tax slab, exemption or TDS amount.
          </p>
          <form method="get" action="/api/form16" className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="f16-emp"
                className="mb-1 block text-xs uppercase tracking-wide text-text-muted"
              >
                Employee
              </label>
              <select
                id="f16-emp"
                name="employeeId"
                required
                className="rounded border border-border bg-background px-3 py-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {Array.from(
                  new Map(rows.map((r) => [r.employee.id, r.employee])).values(),
                ).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} · {e.employeeCode}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="f16-fy"
                className="mb-1 block text-xs uppercase tracking-wide text-text-muted"
              >
                Financial year
              </label>
              <input
                id="f16-fy"
                name="fy"
                defaultValue={financialYearOf(period)}
                placeholder="2026-27"
                className="w-28 rounded border border-border bg-background px-3 py-2 font-mono text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>
            <button
              type="submit"
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-2 text-xs text-text hover:bg-surface-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              <Download size={13} /> Download Form 16
            </button>
          </form>
        </div>
      </Panel>
    </>
  );
}
