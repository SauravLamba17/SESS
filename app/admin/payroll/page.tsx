import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { PayrollRunActions } from "@/components/hr/payroll-run-actions";
import { db } from "@/lib/db";
import { inr, periodLabel } from "@/lib/payroll/format";
import { ErrorPanel } from "@/components/ui/notice";

export const dynamic = "force-dynamic";

async function load() {
  try {
    // One grouped query per status — no per-period row scans.
    const [submitted, finalized, drafts] = await Promise.all([
      db.payroll.groupBy({
        by: ["month"],
        where: { status: "SUBMITTED" },
        _count: { _all: true },
        _sum: { net: true, gross: true, tds: true },
        orderBy: { month: "desc" },
      }),
      db.payroll.groupBy({
        by: ["month"],
        where: { status: "FINALIZED" },
        _count: { _all: true },
        _sum: { net: true },
        orderBy: { month: "desc" },
      }),
      // Not for finalizing — purely to explain an empty queue.
      db.payroll.groupBy({
        by: ["month"],
        where: { status: "DRAFT" },
        _count: { _all: true },
        orderBy: { month: "desc" },
      }),
    ]);
    return { submitted, finalized, drafts, error: null };
  } catch (err) {
    console.error("[admin/payroll] failed:", err);
    return {
      submitted: [],
      finalized: [],
      drafts: [],
      error: "Payroll queue is unavailable right now.",
    };
  }
}

export default async function PayrollFinalizationPage() {
  const { submitted, finalized, drafts, error } = await load();
  const draftsWaiting = drafts.reduce((n, d) => n + d._count._all, 0);
  const draftPeriods = drafts.map((d) => periodLabel(d.month));

  return (
    <>
      <PageHeader
        title="Payroll Finalization"
        description="Runs submitted by HR and awaiting the permanent lock. Finalizing is irreversible — afterwards no code path can alter a figure, and corrections must be issued as separate adjustment records."
      />

      {error && (
        <ErrorPanel>{error}</ErrorPanel>
      )}

      <Panel className="mb-6">
        <PanelHeader title={`Awaiting Finalization · ${submitted.length}`} />
        {submitted.length === 0 ? (
          <div className="px-4 py-8 text-sm">
            <div className="flex items-center gap-2 text-text-muted">
              <StatusDot state="good" /> Nothing awaiting finalization.
            </div>
            {/* An empty queue is ambiguous: it can mean "all done" or "HR
                created drafts but never submitted them". Say which. */}
            {draftsWaiting > 0 && (
              <p className="mt-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
                Note: HR has {draftsWaiting} DRAFT payroll row
                {draftsWaiting === 1 ? "" : "s"} (
                {draftPeriods.join(", ")}) that have not been submitted yet.
                Draft rows never appear here — HR must run &quot;Submit run for
                approval&quot; before you can finalize them.
              </p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {submitted.map((r) => (
              <li key={r.month} className="px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm text-text">
                      <StatusDot state="warn" />
                      <span className="font-medium">{periodLabel(r.month)}</span>
                      <span className="font-mono text-xs text-text-muted">{r.month}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 font-mono text-[11px] text-text-muted">
                      <span>{r._count._all} employees</span>
                      <span>gross ₹{inr(Number(r._sum.gross ?? 0).toFixed(2))}</span>
                      <span>TDS ₹{inr(Number(r._sum.tds ?? 0).toFixed(2))}</span>
                      <span className="text-text">
                        net ₹{inr(Number(r._sum.net ?? 0).toFixed(2))}
                      </span>
                    </div>
                  </div>
                  <PayrollRunActions
                    period={r.month}
                    canCreate={false}
                    canSubmit={false}
                    canFinalize
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-border px-4 py-3 text-xs text-text-muted">
          Finalization is all-or-nothing: if any row changes state mid-transition
          the whole run is rolled back rather than left half-finalized.
        </p>
      </Panel>

      <Panel>
        <PanelHeader title="Finalized Runs" />
        {finalized.length === 0 ? (
          <div className="px-4 py-8 text-sm text-text-muted">No finalized runs yet.</div>
        ) : (
          <ul className="divide-y divide-border">
            {finalized.map((r) => (
              <li
                key={r.month}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
              >
                <span className="inline-flex items-center gap-2">
                  <StatusDot state="good" />
                  <span className="text-text">{periodLabel(r.month)}</span>
                  <span className="text-xs text-text-muted">
                    {r._count._all} employees
                  </span>
                </span>
                <span className="font-mono text-xs text-text-muted">
                  net ₹{inr(Number(r._sum.net ?? 0).toFixed(2))} · locked
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
