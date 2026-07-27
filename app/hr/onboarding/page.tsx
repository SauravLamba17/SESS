import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { OnboardingChecklist } from "@/components/hr/onboarding-checklist";
import { db } from "@/lib/db";
import { ErrorPanel } from "@/components/ui/notice";

export const dynamic = "force-dynamic";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function load() {
  try {
    // Employees WITH onboarding tasks, tasks joined in — one query, no
    // per-employee task lookup as headcount grows.
    const employees = await db.employee.findMany({
      where: { active: true, onboardingTasks: { some: {} } },
      select: {
        id: true,
        name: true,
        employeeCode: true,
        department: true,
        designation: true,
        joiningDate: true,
        onboardingTasks: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { joiningDate: "desc" },
      take: 100,
    });
    return { employees, error: null };
  } catch (err) {
    console.error("[hr/onboarding] failed:", err);
    return { employees: [], error: "Onboarding checklists are unavailable right now." };
  }
}

export default async function OnboardingPage() {
  const { employees, error } = await load();

  const incomplete = employees.filter((e) =>
    e.onboardingTasks.some((t) => !t.completed),
  ).length;

  return (
    <>
      <PageHeader
        title="Onboarding Checklists"
        description="New joiners get a default checklist automatically when they accept an offer. Tick items off as they're done, and add anything role-specific."
      />

      {error && (
        <ErrorPanel>{error}</ErrorPanel>
      )}

      {employees.length === 0 && !error ? (
        <Panel className="px-4 py-12 text-center">
          <p className="text-sm text-text">No onboarding checklists yet.</p>
          <p className="mt-1 text-xs text-text-muted">
            A checklist is created automatically when a candidate accepts an
            offer. You can also add tasks to any employee from here once they
            have one.
          </p>
        </Panel>
      ) : (
        <>
          <Panel className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
            <span className="inline-flex items-center gap-2">
              <StatusDot state={incomplete > 0 ? "warn" : "good"} />
              <span className="text-text-muted">
                {incomplete} of {employees.length} still have outstanding tasks
              </span>
            </span>
          </Panel>

          <div className="space-y-5">
            {employees.map((e) => {
              const done = e.onboardingTasks.filter((t) => t.completed).length;
              const total = e.onboardingTasks.length;
              return (
                <Panel key={e.id}>
                  <PanelHeader
                    title={`${e.name} · ${e.employeeCode}`}
                    action={
                      <span className="inline-flex items-center gap-2 text-xs">
                        <StatusDot state={done === total ? "good" : "warn"} />
                        <span className="font-mono text-text-muted">
                          {done}/{total}
                        </span>
                      </span>
                    }
                  />
                  <div className="p-4">
                    <p className="mb-3 font-mono text-[11px] text-text-muted">
                      {e.department}
                      {e.designation ? ` · ${e.designation}` : ""} · joined{" "}
                      {ymd(e.joiningDate)}
                    </p>
                    <OnboardingChecklist
                      employeeId={e.id}
                      tasks={e.onboardingTasks.map((t) => ({
                        id: t.id,
                        taskName: t.taskName,
                        completed: t.completed,
                        completedAt: t.completedAt ? ymd(t.completedAt) : null,
                      }))}
                    />
                  </div>
                </Panel>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
