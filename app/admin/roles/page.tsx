import { PageHeader } from "@/components/portal/portal-shell";
import { Panel } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { ROLES, ROLE_LABEL, ROLE_HOME, ROLE_RANK } from "@/lib/auth-types";

export default function RolesPermissions() {
  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description="The strict role hierarchy: SUPER_ADMIN > HR > MANAGER > EMPLOYEE. Super Admin has full control."
      />

      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Rank</th>
                <th className="px-4 py-3 font-medium">Landing Route</th>
                <th className="px-4 py-3 font-medium">Portal Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[...ROLES]
                .sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])
                .map((r) => (
                  <tr key={r}>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <StatusDot state="idle" />
                        <span className="text-text">{ROLE_LABEL[r]}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-text-muted">
                      {ROLE_RANK[r]}
                    </td>
                    <td className="px-4 py-3 font-mono text-text-muted">
                      {ROLE_HOME[r]}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-muted">
                      {r === "SUPER_ADMIN"
                        ? "/employee /manager /hr /admin"
                        : r === "HR"
                          ? "/employee /manager /hr"
                          : r === "MANAGER"
                            ? "/employee /manager"
                            : "/employee"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="mt-3 text-xs text-text-muted">
        HR can request permission changes; Super Admin has full control over role
        assignment. Assignment writes are wired in a later phase.
      </p>
    </>
  );
}
