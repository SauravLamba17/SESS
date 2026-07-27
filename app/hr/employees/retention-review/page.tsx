import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader, StatCard } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { EmployeeRetentionActions } from "@/components/hr/employee-retention-actions";
import { db } from "@/lib/db";
import { ErrorPanel } from "@/components/ui/notice";
import {
  RETENTION_YEARS,
  REDACTED_FIELDS,
  PRESERVED_FIELDS,
  ymd as localYmd,
} from "@/lib/employees/retention";

export const dynamic = "force-dynamic";

/** Rows per page — this list is worked through, not browsed. */
const PAGE_SIZE = 25;

/** Local components, not toISOString — these are local-midnight dates. */
function ymd(d: Date | null): string {
  return d ? localYmd(d) : "—";
}

async function load(page: number) {
  const now = new Date();
  try {
    // BOUNDED: only offboarded, not-yet-redacted employees, paginated. The
    // counts are aggregates, not fetched rows.
    const dueWhere = {
      active: false,
      redactedAt: null,
      scheduledRedactionAt: { not: null, lte: now },
    } as const;

    const [due, dueCount, upcoming, redactedCount] = await Promise.all([
      db.employee.findMany({
        where: dueWhere,
        select: {
          id: true,
          name: true,
          employeeCode: true,
          department: true,
          designation: true,
          email: true,
          offboardedAt: true,
          scheduledRedactionAt: true,
          // Counts prove the financial record is intact and staying that way.
          _count: {
            select: {
              payrolls: true,
              attendance: true,
              appraisalScores: true,
              warningLetters: true,
            },
          },
        },
        orderBy: { scheduledRedactionAt: "asc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      db.employee.count({ where: dueWhere }),
      db.employee.count({
        where: {
          active: false,
          redactedAt: null,
          scheduledRedactionAt: { not: null, gt: now },
        },
      }),
      db.employee.count({ where: { redactedAt: { not: null } } }),
    ]);

    return { due, dueCount, upcoming, redactedCount, error: null };
  } catch (err) {
    console.error("[hr/employees/retention-review] failed:", err);
    return {
      due: [],
      dueCount: 0,
      upcoming: 0,
      redactedCount: 0,
      error: "Retention data is unavailable right now.",
    };
  }
}

export default async function EmployeeRetentionReview({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  const { due, dueCount, upcoming, redactedCount, error } = await load(page);
  const totalPages = Math.max(1, Math.ceil(dueCount / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Employee Data Retention"
        description={`Former employees whose ${RETENTION_YEARS}-year retention period has elapsed. Redaction erases personal identifiers only — the employment and payroll record is kept permanently.`}
        action={
          <Link
            href="/hr/employees"
            className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ArrowLeft size={13} />
            Employee Master
          </Link>
        }
      />

      {error && (
        <ErrorPanel>{error}</ErrorPanel>
      )}

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Due for redaction"
          value={dueCount}
          state={dueCount > 0 ? "warn" : "good"}
          status={dueCount > 0 ? "Action required" : "Nothing outstanding"}
        />
        <StatCard
          label="Within retention"
          value={upcoming}
          state="idle"
          status={`Offboarded < ${RETENTION_YEARS}y ago`}
        />
        <StatCard
          label="Already redacted"
          value={redactedCount}
          state="good"
          status="Records still intact"
        />
      </div>

      <Panel className="mb-5 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          What this policy does
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          <div className="rounded border border-danger/30 bg-danger/5 p-3">
            <p className="font-medium text-danger">Erased on redaction</p>
            <p className="mt-1 font-mono text-[11px] text-text-muted">
              {REDACTED_FIELDS.join(", ")}
            </p>
            <p className="mt-1.5 text-[11px] text-text-muted">
              Direct personal identifiers with no remaining audit purpose.
              Emergency contact names a third party who never worked here.
            </p>
          </div>
          <div className="rounded border border-good/30 bg-good/5 p-3">
            <p className="font-medium text-good">Kept permanently</p>
            <p className="mt-1 font-mono text-[11px] text-text-muted">
              {PRESERVED_FIELDS.join(", ")}
            </p>
            <p className="mt-1.5 text-[11px] text-text-muted">
              Plus every payroll, attendance, appraisal, warning, expense and
              salary record. The employee row is never deleted — the retention
              period exists precisely to keep these auditable.
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-text-muted">
          <span className="text-text">Why the name is kept:</span> payslips, Form
          16 and warning letters are legal documents that name the person they
          concern. Redacting the name would leave financial records that cannot
          be tied to anyone, defeating the audit purpose of the retention period
          and making a lawful subject-access request unanswerable. Erasing a name
          is a deliberate legal decision for a human, not this routine default.
        </p>
      </Panel>

      <Panel>
        <PanelHeader
          title={`Due for review · ${dueCount}`}
          action={
            totalPages > 1 ? (
              <span className="font-mono text-xs text-text-muted">
                page {page} of {totalPages}
              </span>
            ) : undefined
          }
        />
        {due.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-text-muted">
            {error
              ? "—"
              : "No former employee has passed their retention date. Nothing to action."}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {due.map((e) => (
              <li key={e.id} className="px-4 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-text">
                      <StatusDot state="warn" />
                      <span>{e.name}</span>
                      <span className="font-mono text-xs text-text-muted">
                        {e.employeeCode}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-text-muted">
                      {e.department}
                      {e.designation ? ` · ${e.designation}` : ""}
                      {" · left "}
                      {ymd(e.offboardedAt)}
                      {" · due "}
                      <span className="text-warn">{ymd(e.scheduledRedactionAt)}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-muted">
                      <span>
                        Records retained:{" "}
                        <span className="font-mono text-text">
                          {e._count.payrolls}
                        </span>{" "}
                        payroll
                      </span>
                      <span>
                        <span className="font-mono text-text">
                          {e._count.attendance}
                        </span>{" "}
                        attendance
                      </span>
                      <span>
                        <span className="font-mono text-text">
                          {e._count.appraisalScores}
                        </span>{" "}
                        appraisal
                      </span>
                      <span>
                        <span className="font-mono text-text">
                          {e._count.warningLetters}
                        </span>{" "}
                        warning
                      </span>
                      <span className="text-good">— all kept</span>
                    </div>
                  </div>

                  <div className="w-full shrink-0 lg:w-[26rem]">
                    <EmployeeRetentionActions
                      employeeId={e.id}
                      name={e.name}
                      redactedFields={REDACTED_FIELDS}
                      preservedFields={PRESERVED_FIELDS}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs">
            {page > 1 ? (
              <Link
                href={`/hr/employees/retention-review?page=${page - 1}`}
                className="rounded border border-border px-2.5 py-1 text-text-muted hover:text-text"
              >
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            {page < totalPages ? (
              <Link
                href={`/hr/employees/retention-review?page=${page + 1}`}
                className="rounded border border-border px-2.5 py-1 text-text-muted hover:text-text"
              >
                Next →
              </Link>
            ) : (
              <span />
            )}
          </div>
        )}
      </Panel>
    </>
  );
}
