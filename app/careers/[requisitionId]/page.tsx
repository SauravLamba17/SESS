import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { ApplicationForm } from "@/components/careers/application-form";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function JobListingPage({
  params,
}: {
  params: { requisitionId: string };
}) {
  let requisition;
  try {
    requisition = await db.jobRequisition.findUnique({
      where: { id: params.requisitionId },
      select: {
        id: true,
        title: true,
        department: true,
        description: true,
        openings: true,
        status: true,
      },
    });
  } catch (err) {
    console.error("[careers/listing] failed:", err);
    return (
      <Panel className="flex items-center gap-3 px-4 py-3">
        <StatusDot state="danger" />
        <span className="text-sm text-danger">
          This listing is unavailable right now. Please try again shortly.
        </span>
      </Panel>
    );
  }

  if (!requisition) notFound();

  // A CLOSED or ON_HOLD role is reachable by direct link (someone may have
  // bookmarked it). Say so plainly instead of showing a form that would be
  // rejected server-side anyway.
  const isOpen = requisition.status === "OPEN";

  return (
    <>
      <Link
        href="/careers"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text"
      >
        <ArrowLeft size={13} /> All open positions
      </Link>

      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
          {requisition.department}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-text">{requisition.title}</h1>
        <p className="mt-2 font-mono text-[11px] text-text-muted">
          {requisition.openings} opening{requisition.openings === 1 ? "" : "s"}
        </p>
      </div>

      <Panel className="mb-8 p-6">
        <h2 className="mb-3 text-sm font-semibold text-text">About this role</h2>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-muted">
          {requisition.description}
        </p>
      </Panel>

      {isOpen ? (
        <Panel className="p-6">
          <h2 className="mb-4 text-sm font-semibold text-text">Apply for this role</h2>
          <ApplicationForm requisitionId={requisition.id} />
        </Panel>
      ) : (
        <Panel className="flex items-start gap-3 px-4 py-4">
          <StatusDot state="idle" className="mt-1.5" />
          <div>
            <p className="text-sm text-text">
              Applications for this role are closed.
            </p>
            <p className="mt-1 text-xs text-text-muted">
              <Link href="/careers" className="text-accent underline">
                See our other open positions
              </Link>
              .
            </p>
          </div>
        </Panel>
      )}
    </>
  );
}
