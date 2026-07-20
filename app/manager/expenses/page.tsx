import { getEffectiveUserId } from "@/lib/auth";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { DecisionButtons } from "@/components/ui/decision-buttons";
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
  if (!userId) return { manager: null, pending: [], handled: [], error: null };
  try {
    const manager = await getEmployeeByClerkId(userId);
    if (!manager) return { manager: null, pending: [], handled: [], error: null };

    // Both lists scoped at the QUERY level to direct reports — never in the UI.
    const [pending, handled] = await Promise.all([
      db.expenseClaim.findMany({
        where: { status: "PENDING", employee: { managerId: manager.id, active: true } },
        include: { employee: { select: { name: true, employeeCode: true } } },
        orderBy: { createdAt: "asc" },
      }),
      db.expenseClaim.findMany({
        where: {
          status: { in: ["APPROVED", "REJECTED"] },
          employee: { managerId: manager.id },
        },
        include: { employee: { select: { name: true } } },
        orderBy: { approvedAt: "desc" },
        take: 12,
      }),
    ]);
    return { manager, pending, handled, error: null };
  } catch (err) {
    console.error("[manager/expenses] failed:", err);
    return { manager: null, pending: [], handled: [], error: "Team expenses are unavailable right now." };
  }
}

export default async function TeamExpensesPage() {
  const { manager, pending, handled, error } = await load();

  const pendingTotal = pending.reduce(
    (n, c) => n + Number(c.amount),
    0,
  );

  return (
    <>
      <PageHeader
        title="Team Expenses"
        description="Approve reimbursement claims for your direct reports — your reports only."
      />

      {error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{error}</span>
        </Panel>
      )}

      {!manager && !error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="warn" />
          <span className="text-sm text-text-muted">
            No employee record is linked to your account yet.
          </span>
        </Panel>
      )}

      {manager && (
        <div className="space-y-6">
          <Panel>
            <PanelHeader
              title={`Pending Claims (${pending.length})`}
              action={
                pending.length > 0 ? (
                  <span className="font-mono text-xs text-text-muted">
                    ₹{inr(pendingTotal.toFixed(2))} total
                  </span>
                ) : undefined
              }
            />
            {pending.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-8 text-sm text-text-muted">
                <StatusDot state="good" /> Nothing awaiting your approval.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {pending.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm text-text">
                        <span>{c.employee.name}</span>
                        <span className="font-mono text-xs text-text-muted">
                          {c.employee.employeeCode}
                        </span>
                        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-text-muted">
                          {EXPENSE_CATEGORY_LABEL[c.category] ?? c.category}
                        </span>
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
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="font-mono text-sm text-text">
                        ₹{inr(c.amount.toFixed(2))}
                      </span>
                      <DecisionButtons id={c.id} endpoint="/api/manager/expense" />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Recently Handled" />
            {handled.length === 0 ? (
              <div className="px-4 py-8 text-sm text-text-muted">No decisions yet.</div>
            ) : (
              <ul className="divide-y divide-border">
                {handled.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                  >
                    <span className="min-w-0 truncate text-text">
                      {c.employee.name}
                      <span className="ml-2 text-xs text-text-muted">
                        {EXPENSE_CATEGORY_LABEL[c.category] ?? c.category}
                      </span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-2 text-xs">
                      <span className="font-mono text-text-muted">
                        ₹{inr(c.amount.toFixed(2))}
                      </span>
                      <StatusDot state={EXPENSE_STATUS_DOT[c.status]} />
                      <span className="text-text-muted">{c.status}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-border px-4 py-3 text-xs text-text-muted">
              Approved claims are picked up by the next payroll run and stamped
              as reimbursed, so the same claim can never be paid twice.
            </p>
          </Panel>
        </div>
      )}
    </>
  );
}
