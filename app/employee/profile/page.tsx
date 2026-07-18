import { auth } from "@clerk/nextjs/server";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { ProfileForm } from "@/components/employee/profile-form";
import { getEmployeeByClerkId } from "@/lib/data/scope";

export const dynamic = "force-dynamic";

function fmtDate(d: Date): string {
  return d.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

async function loadEmployee() {
  const { userId } = await auth();
  if (!userId) return { employee: null, error: null };
  try {
    const employee = await getEmployeeByClerkId(userId);
    return { employee, error: null };
  } catch (err) {
    console.error("[my-profile] load failed:", err);
    return { employee: null, error: "Profile is unavailable right now." };
  }
}

function ReadOnlyField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <span className="mb-1 block text-xs uppercase tracking-wide text-text-muted">
        {label}
      </span>
      {mono ? (
        <span className="inline-block rounded border border-border bg-surface-raised px-2.5 py-1 font-mono text-sm text-text">
          {value}
        </span>
      ) : (
        <span className="text-sm text-text">{value}</span>
      )}
    </div>
  );
}

export default async function MyProfilePage() {
  const { employee, error } = await loadEmployee();

  return (
    <>
      <PageHeader
        title="My Profile"
        description="Your employment details and editable contact information."
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
            No employee record is linked to your account yet. Your profile will
            appear once HR completes onboarding.
          </span>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Employment Details" />
          <div className="grid grid-cols-2 gap-5 p-4">
            <ReadOnlyField
              label="Employee Code"
              value={employee?.employeeCode ?? "—"}
              mono
            />
            <ReadOnlyField
              label="Department"
              value={employee?.department ?? "—"}
            />
            <ReadOnlyField
              label="Designation"
              value={employee?.designation ?? "—"}
            />
            <ReadOnlyField
              label="Joining Date"
              value={employee ? fmtDate(employee.joiningDate) : "—"}
            />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Contact Information" />
          <div className="p-4">
            <ProfileForm
              initialName={employee?.name ?? ""}
              initialEmergencyContact={employee?.emergencyContact ?? ""}
            />
          </div>
        </Panel>
      </div>
    </>
  );
}
