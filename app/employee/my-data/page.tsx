import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { MyDataDownload } from "@/components/reports/my-data-download";
import { currentMonthRange } from "@/lib/reports/range";

// Tab title for this route; the root layout appends " · SESS".
export const metadata = { title: "My Data" };

export const dynamic = "force-dynamic";

/**
 * My Data Export — the Employee portal's only reports-adjacent surface.
 *
 * Employees still have NO access to any of the ten organisation reports; this
 * one is about the viewer and nobody else, and the server resolves "the
 * viewer" from the session rather than from anything this page sends.
 */
export default function MyDataPage() {
  const range = currentMonthRange();

  return (
    <>
      <PageHeader
        title="My Data"
        description="Download a copy of everything SESS holds about you, as a PDF."
      />

      <div className="space-y-5">
        <Panel>
          <PanelHeader title="Download your data" />
          <div className="p-4">
            <MyDataDownload
              defaultStart={range.startLabel}
              defaultEnd={range.endLabel}
            />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="What's included" />
          <div className="space-y-2 p-4 text-sm text-text-muted">
            <p>
              Your profile, attendance, leave, production, quality, appraisals,
              warnings, consents and expenses for the dates you choose.
            </p>
            <ul className="mt-3 space-y-1.5 text-xs">
              <li className="flex gap-2">
                <span className="text-text-muted">·</span>
                Appraisal scores appear only after they’re{" "}
                <span className="text-text">published</span>.
              </li>
              <li className="flex gap-2">
                <span className="text-text-muted">·</span>
                Warning letters appear only once{" "}
                <span className="text-text">released</span> to you. Drafts are
                never included.
              </li>
              <li className="flex gap-2">
                <span className="text-text-muted">·</span>
                Payslips are <span className="text-text">listed</span>, not
                embedded — download the documents themselves from Payslips
                &amp; Financials.
              </li>
            </ul>
          </div>
        </Panel>

        <Panel className="flex items-start gap-3 px-4 py-3">
          <StatusDot state="good" className="mt-1" />
          <span className="text-xs text-text-muted">
            This file only ever contains your own records.
          </span>
        </Panel>
      </div>
    </>
  );
}
