import { getEffectiveUserId } from "@/lib/auth";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { ExpenseForm } from "@/components/employee/expense-form";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import {
  inr,
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_STATUS_DOT,
} from "@/lib/payroll/format";

export const dynamic = "force-dynamic";

function fmtDate(d: Date): string {
  return d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

async function load() {
  const userId = await getEffectiveUserId();
  if (!userId) return { employee: null, claims: [], error: null };
  try {
    const employee = await getEmployeeByClerkId(userId);
    if (!employee) return { employee: null, claims: [], error: null };

    const claims = await db.expenseClaim.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { employee, claims, error: null };
  } catch (err) {
    console.error("[employee/expenses] failed:", err);
    return { employee: null, claims: [], error: "Expense claims are unavailable right now." };
  }
}

export default async function MyExpensesPage() {
  const { employee, claims, error } = await load();

  const pendingTotal = claims
    .filter((c) => c.status === "PENDING")
    .reduce((n, c) => n + Number(c.amount), 0);

  return (
    <>
      <PageHeader
        title="Expense Claims"
        description="Submit reimbursement claims. Your manager approves them, and approved claims are paid out with your next finalized payroll run."
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
          <Panel>
            <PanelHeader title="New Claim" />
            <div className="p-4">
              <ExpenseForm />
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title={`My Claims · ${claims.length}`}
              action={
                pendingTotal > 0 ? (
                  <span className="font-mono text-xs text-text-muted">
                    {claims.filter((c) => c.status === "PENDING").length} pending
                  </span>
                ) : undefined
              }
            />
            {claims.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-text-muted">
                No claims yet — submit one above.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {claims.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm text-text">
                        <StatusDot state={EXPENSE_STATUS_DOT[c.status]} />
                        <span>{EXPENSE_CATEGORY_LABEL[c.category] ?? c.category}</span>
                        <span className="text-xs text-text-muted">{c.status}</span>
                        {c.includedInPayrollId && (
                          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-text-muted">
                            reimbursed
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-text-muted">{c.description}</p>
                      <div className="mt-0.5 font-mono text-[11px] text-text-muted">
                        {fmtDate(c.date)}
                        {c.receiptUrl && (
                          <>
                            {" · "}
                            <a
                              href={c.receiptUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent underline"
                            >
                              receipt
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-sm text-text">
                      ₹{inr(c.amount.toFixed(2))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-border px-4 py-3 text-xs text-text-muted">
              An approved claim is paid as a reimbursement line on your payslip —
              added after deductions, since a reimbursement is not taxable salary.
            </p>
          </Panel>
        </div>
      )}
    </>
  );
}
