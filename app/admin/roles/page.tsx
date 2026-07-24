import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { RoleSelect } from "@/components/admin/role-select";
import { db } from "@/lib/db";
import { ROLE_LABEL, type Role } from "@/lib/auth-types";

export const dynamic = "force-dynamic";

/**
 * READ-ONLY permission matrix — the reference for what each role means.
 * Mirrors what the code actually enforces (middleware portal gates + in-route
 * role checks); update it if those change.
 */
const MATRIX: { module: string; access: Record<Role, string> }[] = [
  { module: "Attendance", access: { EMPLOYEE: "Own punches", MANAGER: "Team view", HR: "Org oversight + review flags", SUPER_ADMIN: "Full" } },
  { module: "Production & Quality", access: { EMPLOYEE: "Log/view own", MANAGER: "Team + targets + quality entry", HR: "Org view", SUPER_ADMIN: "Full" } },
  { module: "Leave & Expenses", access: { EMPLOYEE: "Request/claim own", MANAGER: "Approve team", HR: "Org view + payroll fold-in", SUPER_ADMIN: "Full" } },
  { module: "Payroll", access: { EMPLOYEE: "Own payslips/Form 16", MANAGER: "Team summary", HR: "Run + draft + submit", SUPER_ADMIN: "Finalize (lock)" } },
  { module: "Salary Structure & Advances", access: { EMPLOYEE: "—", MANAGER: "—", HR: "Manage", SUPER_ADMIN: "Full" } },
  { module: "Appraisal", access: { EMPLOYEE: "Own published score", MANAGER: "Team feedback", HR: "Cycles + compute + publish", SUPER_ADMIN: "Formula weights" } },
  { module: "Warning Letters", access: { EMPLOYEE: "Acknowledge own", MANAGER: "Draft", HR: "Release", SUPER_ADMIN: "Full" } },
  { module: "Recruitment / ATS", access: { EMPLOYEE: "—", MANAGER: "Interview feedback", HR: "Pipeline + offers + hire", SUPER_ADMIN: "Offer approval" } },
  { module: "Employee Master & Onboarding", access: { EMPLOYEE: "Own profile", MANAGER: "—", HR: "Onboard/offboard + invitations", SUPER_ADMIN: "Full" } },
  { module: "Idle Tracking", access: { EMPLOYEE: "Own totals", MANAGER: "Team aggregates", HR: "Org view + consent + tokens", SUPER_ADMIN: "Threshold + kill switch" } },
  { module: "Engagement (wall / pulse)", access: { EMPLOYEE: "Participate", MANAGER: "Participate", HR: "Manage surveys", SUPER_ADMIN: "Module toggle" } },
  { module: "Audit Log & System Config", access: { EMPLOYEE: "—", MANAGER: "—", HR: "—", SUPER_ADMIN: "Full" } },
];

const ROLE_ORDER: Role[] = ["EMPLOYEE", "MANAGER", "HR", "SUPER_ADMIN"];

async function load() {
  try {
    // Two set-based queries — no per-row lookups, regardless of headcount.
    const [users, unlinked] = await Promise.all([
      db.user.findMany({
        include: {
          employee: {
            select: { id: true, name: true, employeeCode: true, department: true, active: true },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
      db.employee.findMany({
        where: { user: null, active: true },
        select: { id: true, name: true, employeeCode: true, pendingInvitationId: true },
        orderBy: { employeeCode: "asc" },
      }),
    ]);
    return { users, unlinked, error: null };
  } catch (err) {
    console.error("[admin/roles] failed:", err);
    return { users: [], unlinked: [], error: "User data is unavailable right now." };
  }
}

export default async function RolesPermissions() {
  const { users, unlinked, error } = await load();

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description="Manage roles for existing accounts. New accounts are created through onboarding invitations, never here."
      />

      {error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{error}</span>
        </Panel>
      )}

      <div className="space-y-6">
        <Panel>
          <PanelHeader title={`Accounts · ${users.length}`} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-medium">Account</th>
                  <th className="px-4 py-3 font-medium">Linked Employee</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => (
                  <tr key={u.id} className="align-top hover:bg-surface-raised/50">
                    <td className="px-4 py-3 font-mono text-xs text-text-muted">{u.clerkId}</td>
                    <td className="px-4 py-3">
                      {u.employee ? (
                        <>
                          <div className="text-text">{u.employee.name}</div>
                          <div className="font-mono text-xs text-text-muted">
                            {u.employee.employeeCode} · {u.employee.department}
                            {!u.employee.active && " · offboarded"}
                          </div>
                        </>
                      ) : (
                        <span className="text-text-muted">— none —</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <StatusDot state="good" />
                        <span className="text-text-muted">Active account</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <RoleSelect userId={u.id} currentRole={u.role as Role} />
                    </td>
                  </tr>
                ))}
                {users.length === 0 && !error && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-text-muted">No accounts yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-4 py-3 text-xs text-text-muted">
            A role change updates the SESS database first, then the Clerk
            account&apos;s metadata. If the Clerk sync fails, the row shows an
            explicit retry — it is never left silently out of sync. Audit:{" "}
            <span className="font-mono">USER_ROLE_CHANGED</span>. The last Super
            Admin cannot be demoted.
          </p>
        </Panel>

        {unlinked.length > 0 && (
          <Panel>
            <PanelHeader title={`Employees without accounts · ${unlinked.length}`} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {unlinked.map((e) => (
                    <tr key={e.id}>
                      <td className="px-4 py-2.5">
                        <span className="text-text">{e.name}</span>{" "}
                        <span className="font-mono text-xs text-text-muted">{e.employeeCode}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <StatusDot state={e.pendingInvitationId ? "warn" : "idle"} />
                          <span className="text-xs text-text-muted">
                            {e.pendingInvitationId
                              ? "Invitation sent, awaiting acceptance"
                              : "No login access"}
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border px-4 py-3 text-xs text-text-muted">
              Invitations are sent from the Employee Master page — roles here
              apply only once an account exists.
            </p>
          </Panel>
        )}

        <Panel>
          <PanelHeader title="Permission Matrix (read-only reference)" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-medium">Module</th>
                  {ROLE_ORDER.map((r) => (
                    <th key={r} className="px-4 py-3 font-medium">{ROLE_LABEL[r]}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {MATRIX.map((row) => (
                  <tr key={row.module}>
                    <td className="px-4 py-2.5 text-text">{row.module}</td>
                    {ROLE_ORDER.map((r) => (
                      <td key={r} className="px-4 py-2.5 text-xs text-text-muted">
                        {row.access[r]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-4 py-3 text-xs text-text-muted">
            Hierarchy: SUPER_ADMIN &gt; HR &gt; MANAGER &gt; EMPLOYEE — each
            level can also open the portals below it. Enforced in middleware
            and in every API route; this table is documentation, not the
            enforcement.
          </p>
        </Panel>
      </div>
    </>
  );
}
