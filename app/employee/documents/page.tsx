import { getEffectiveUserId } from "@/lib/auth";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { AcknowledgeButton } from "@/components/employee/acknowledge-button";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { ErrorPanel, UnlinkedEmployeeNotice } from "@/components/ui/notice";
import { formatStamp } from "@/lib/time-display";
import { ymd } from "@/lib/reports/range";
import { ATTESTATION_LABEL, ATTESTATION_DISCLAIMER } from "@/lib/attestation";

export const dynamic = "force-dynamic";

async function load() {
  const userId = await getEffectiveUserId();
  if (!userId) return { employee: null, error: null };
  try {
    const employee = await getEmployeeByClerkId(userId);
    if (!employee) return { employee: null, error: null };
    // ONLY released letters for this employee — drafts are never queried here.
    const letters = await db.warningLetter.findMany({
      where: { employeeId: employee.id, status: "RELEASED" },
      orderBy: { releasedAt: "desc" },
    });
    return { employee, error: null, letters };
  } catch (err) {
    console.error("[employee/documents] failed:", err);
    return { employee: null, error: "Documents are unavailable right now." };
  }
}

export default async function MyDocumentsPage() {
  const data = await load();

  return (
    <>
      <PageHeader
        title="My Documents"
        description="Warning letters that have been formally released to you."
      />

      {data.error && (
        <ErrorPanel>{data.error}</ErrorPanel>
      )}

      {!data.employee && !data.error && (
        <UnlinkedEmployeeNotice />
      )}

      {data.employee && (
        <Panel>
          <PanelHeader title="Warning Letters" />
          {data.letters.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <StatusDot state="good" />
              <p className="text-sm text-text">No warning letters on record</p>
              <p className="text-xs text-text-muted">Only letters formally released by HR appear here.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {data.letters.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm text-text">{l.reason}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-text-muted">
                      released {l.releasedAt ? ymd(l.releasedAt) : "—"}
                    </p>
                    {l.fileUrl && (
                      <a href={l.fileUrl} className="mt-0.5 inline-block text-xs text-info underline" target="_blank" rel="noreferrer">
                        View attachment
                      </a>
                    )}
                  </div>
                  {l.acknowledged ? (
                    <div className="shrink-0 text-right">
                      <span className="inline-flex items-center gap-2 text-xs">
                        <StatusDot state="good" />
                        <span className="text-text-muted">Acknowledged</span>
                      </span>
                      {/* The Attestation Record itself — what was typed, when,
                          and from where. Labelled so it is never mistaken for
                          a legal signature. */}
                      {l.attestedName && (
                        <div className="mt-1 rounded border border-border bg-surface-raised/40 px-2 py-1.5 text-left">
                          <p className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
                            {ATTESTATION_LABEL}
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] text-text">
                            {l.attestedName}
                          </p>
                          <p className="font-mono text-[10px] text-text-muted">
                            {formatStamp(l.attestedAt)}
                            {l.attestedIp ? ` · ${l.attestedIp}` : ""}
                          </p>
                          <p className="mt-0.5 text-[9px] text-text-muted">
                            {ATTESTATION_DISCLAIMER}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <AcknowledgeButton id={l.id} employeeName={data.employee.name} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </>
  );
}
