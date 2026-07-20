import { UserCog, LogIn } from "lucide-react";
import { db } from "@/lib/db";
import { getRealIdentity, getImpersonation } from "@/lib/auth";
import { startImpersonation, stopImpersonation } from "@/app/admin/impersonate/actions";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { ROLE_LABEL, ROLE_HOME } from "@/lib/auth-types";

const cardClass =
  "flex w-full flex-col rounded border border-border bg-surface p-4 text-left transition-colors hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/**
 * Super-Admin-only impersonation launcher. Renders only for the REAL Super
 * Admin (guarded server-side). Each card is a form whose action is a bound
 * server action — click sets the signed cookie and redirects. No dropdown,
 * no confirmation: click and go.
 */
export async function ImpersonatePanel() {
  const { realRole } = await getRealIdentity();
  if (realRole !== "SUPER_ADMIN") return null;

  const [users, active] = await Promise.all([
    db.user.findMany({
      where: { role: { in: ["HR", "MANAGER", "EMPLOYEE"] }, employee: { active: true } },
      include: { employee: { select: { id: true, employeeCode: true, name: true } } },
      orderBy: { employee: { employeeCode: "asc" } },
    }),
    getImpersonation(),
  ]);

  return (
    <Panel className="mb-6">
      <PanelHeader
        title="Impersonate (testing)"
        action={
          <span className="flex items-center gap-2 text-xs text-text-muted">
            <StatusDot state="warn" />
            Super-Admin-only · audited
          </span>
        }
      />
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
        {/* Myself — clears impersonation */}
        <form action={stopImpersonation}>
          <button type="submit" className={cardClass}>
            <div className="mb-2 flex items-center gap-2">
              <StatusDot state={active ? "idle" : "good"} />
              <span className="font-mono text-[11px] uppercase tracking-wide text-text-muted">
                SUPER_ADMIN
              </span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-sm text-text">
              <UserCog size={14} /> Myself
            </span>
            <span className="mt-1 font-mono text-xs text-text-muted">{ROLE_HOME.SUPER_ADMIN}</span>
          </button>
        </form>

        {users.map((u) =>
          u.employee ? (
            <form key={u.id} action={startImpersonation.bind(null, u.employee.id)}>
              <button type="submit" className={cardClass}>
                <div className="mb-2 flex items-center gap-2">
                  <StatusDot state={active?.eid === u.employee.id ? "danger" : "idle"} />
                  <span className="font-mono text-[11px] uppercase tracking-wide text-text-muted">
                    {u.role}
                  </span>
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm text-text">
                  <LogIn size={14} /> {u.employee.name}
                </span>
                <span className="mt-1 font-mono text-xs text-text-muted">
                  {u.employee.employeeCode} · {ROLE_LABEL[u.role]}
                </span>
              </button>
            </form>
          ) : null,
        )}
      </div>
    </Panel>
  );
}
