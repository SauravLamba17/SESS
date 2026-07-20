import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { ShiftForm } from "@/components/hr/shift-form";
import { ShiftActiveToggle } from "@/components/hr/shift-deactivate-button";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

async function load() {
  try {
    // One query with a relation _count — no per-shift employee lookups.
    const shifts = await db.shift.findMany({
      include: { _count: { select: { employees: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return { shifts, error: null };
  } catch (err) {
    console.error("[hr/shifts] failed:", err);
    return { shifts: [], error: "Shifts are unavailable right now." };
  }
}

export default async function ShiftsPage() {
  const { shifts, error } = await load();

  return (
    <>
      <PageHeader
        title="Shifts"
        description="Named shifts define the on-time cut-off (start + grace) that drives each employee's lateFlag."
      />

      {error && (
        <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{error}</span>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="New Shift" />
          <div className="p-4">
            <ShiftForm />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title={`Shifts · ${shifts.length}`} />
          {shifts.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-text-muted">
              No shifts yet — create one.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {shifts.map((s) => (
                <li key={s.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm text-text">
                        <StatusDot state={s.active ? "good" : "idle"} />
                        <span>{s.name}</span>
                        {!s.active && (
                          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-text-muted">
                            inactive
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-text-muted">
                        {s.startTime}–{s.endTime} · +{s.gracePeriodMinutes}m grace ·{" "}
                        {s._count.employees} assigned
                      </div>
                    </div>
                    <ShiftActiveToggle
                      id={s.id}
                      active={s.active}
                      assignedCount={s._count.employees}
                    />
                  </div>

                  <details className="mt-2 rounded border border-border bg-surface-raised/40">
                    <summary className="cursor-pointer px-3 py-1.5 text-xs text-text-muted">
                      Edit
                    </summary>
                    <div className="p-3">
                      <ShiftForm
                        initial={{
                          id: s.id,
                          name: s.name,
                          startTime: s.startTime,
                          endTime: s.endTime,
                          gracePeriodMinutes: s.gracePeriodMinutes,
                        }}
                      />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <p className="px-4 py-3 text-xs text-text-muted">
            Shifts are never hard-deleted — deactivate instead, so no employee&apos;s
            assignment is orphaned.
          </p>
        </Panel>
      </div>
    </>
  );
}
