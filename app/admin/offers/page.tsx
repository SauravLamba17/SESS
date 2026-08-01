import Link from "next/link";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { OfferApproveButton } from "@/components/admin/offer-approve-button";
import { db } from "@/lib/db";
import { inr } from "@/lib/payroll/format";
import { ErrorPanel } from "@/components/ui/notice";
import { ymd as toYmd } from "@/lib/reports/range";

export const dynamic = "force-dynamic";

/** Local-date formatter with a dash for null. Delegates to the shared ymd()
 *  — toISOString() here rendered a day early for any IST-local midnight. */
function ymd(d: Date | null): string {
  return d ? toYmd(d) : "—";
}

async function load() {
  try {
    // Two queries total — pending approvals and recent decided offers. The
    // candidate and requisition come in via includes, not per-row lookups.
    const [pending, decided] = await Promise.all([
      db.offer.findMany({
        where: { status: "DRAFT" },
        include: {
          application: {
            select: {
              id: true,
              candidate: { select: { name: true } },
              jobRequisition: { select: { title: true, department: true } },
            },
          },
        },
        orderBy: { id: "desc" },
      }),
      db.offer.findMany({
        where: { status: { not: "DRAFT" } },
        include: {
          application: {
            select: {
              id: true,
              candidate: { select: { name: true } },
              jobRequisition: { select: { title: true } },
            },
          },
        },
        orderBy: { approvedAt: "desc" },
        take: 15,
      }),
    ]);
    return { pending, decided, error: null };
  } catch (err) {
    console.error("[admin/offers] failed:", err);
    return { pending: [], decided: [], error: "Offer queue is unavailable right now." };
  }
}

export default async function OfferApprovalPage() {
  const { pending, decided, error } = await load();

  return (
    <>
      <PageHeader
        title="Offer Approvals"
        description="Offers drafted by HR awaiting your authorisation. HR cannot send an offer until it is approved here — and cannot approve their own."
      />

      {error && (
        <ErrorPanel>{error}</ErrorPanel>
      )}

      <Panel className="mb-6">
        <PanelHeader title={`Awaiting Approval · ${pending.length}`} />
        {pending.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-10 text-sm text-text-muted">
            <StatusDot state="good" /> No offers awaiting approval.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {pending.map((o) => {
              const gross = o.proposedBasic
                .plus(o.proposedHra)
                .plus(o.proposedSpecialAllowance);
              return (
                <li key={o.id} className="flex items-start justify-between gap-4 px-4 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-text">
                      <StatusDot state="warn" />
                      <Link
                        href={`/hr/candidates/${o.application.id}`}
                        className="font-medium hover:text-accent hover:underline"
                      >
                        {o.application.candidate.name}
                      </Link>
                      <span className="text-xs text-text-muted">
                        {o.proposedDesignation}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 font-mono text-[11px] text-text-muted">
                      <span>{o.application.jobRequisition.title}</span>
                      <span>{o.proposedDepartment}</span>
                      <span>joins {ymd(o.joiningDate)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 font-mono text-[11px] text-text-muted">
                      <span>basic ₹{inr(o.proposedBasic.toFixed(2))}</span>
                      <span>hra ₹{inr(o.proposedHra.toFixed(2))}</span>
                      <span>special ₹{inr(o.proposedSpecialAllowance.toFixed(2))}</span>
                      <span className="text-text">
                        monthly gross ₹{inr(gross.toFixed(2))}
                      </span>
                    </div>
                  </div>
                  <OfferApproveButton
                    id={o.id}
                    candidateName={o.application.candidate.name}
                    monthlyGross={inr(gross.toFixed(2))}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <p className="border-t border-border px-4 py-3 text-xs text-text-muted">
          Approval authorises the terms. HR then marks the offer as sent, and
          records the candidate&apos;s real-world response — accepting converts
          them into an employee automatically.
        </p>
      </Panel>

      <Panel>
        <PanelHeader title="Recently Decided" />
        {decided.length === 0 ? (
          <div className="px-4 py-8 text-sm text-text-muted">No decided offers yet.</div>
        ) : (
          <ul className="divide-y divide-border">
            {decided.map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
              >
                <span className="min-w-0 truncate">
                  <span className="text-text">{o.application.candidate.name}</span>
                  <span className="ml-2 text-xs text-text-muted">
                    {o.application.jobRequisition.title}
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-2 text-xs">
                  <StatusDot
                    state={
                      o.status === "ACCEPTED"
                        ? "good"
                        : o.status === "DECLINED" || o.status === "WITHDRAWN"
                          ? "danger"
                          : "warn"
                    }
                  />
                  <span className="text-text-muted">{o.status}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
