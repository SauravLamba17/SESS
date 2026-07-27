import Link from "next/link";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PrintButton } from "@/components/ui/print-button";
import { db } from "@/lib/db";
import { ErrorPanel } from "@/components/ui/notice";
import {
  buildAuditQuery,
  totalPages,
  AUDIT_PAGE_SIZE,
} from "@/lib/audit-query";

export const dynamic = "force-dynamic";

function fmt(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

async function load(sp: Record<string, string | undefined>) {
  const q = buildAuditQuery({
    action: sp.action,
    actor: sp.actor,
    from: sp.from,
    to: sp.to,
    page: sp.page ? Number(sp.page) : 1,
    pageSize: AUDIT_PAGE_SIZE,
  });

  try {
    // THREE queries, none of them unbounded:
    //  1. the page of rows      — skip/take, server-side
    //  2. the matching count    — for pagination, computed in Postgres
    //  3. distinct action names — for the filter dropdown
    // The row query never fetches more than `take` rows regardless of how
    // large the table grows.
    const [rows, total, actions] = await Promise.all([
      db.auditLog.findMany({
        where: q.where,
        orderBy: { timestamp: "desc" },
        skip: q.skip,
        take: q.take,
      }),
      db.auditLog.count({ where: q.where }),
      db.auditLog.findMany({
        distinct: ["action"],
        select: { action: true },
        orderBy: { action: "asc" },
      }),
    ]);
    return { rows, total, actions: actions.map((a) => a.action), q, error: null };
  } catch (err) {
    console.error("[admin/audit-log] failed:", err);
    return {
      rows: [],
      total: 0,
      actions: [],
      q,
      error: "The audit log is unavailable right now.",
    };
  }
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const { rows, total, actions, q, error } = await load(searchParams);
  const pages = totalPages(total, q.pageSize);
  const first = total === 0 ? 0 : q.skip + 1;
  const last = Math.min(q.skip + q.pageSize, total);

  // Preserve active filters when paging.
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (searchParams.action) params.set("action", searchParams.action);
    if (searchParams.actor) params.set("actor", searchParams.actor);
    if (searchParams.from) params.set("from", searchParams.from);
    if (searchParams.to) params.set("to", searchParams.to);
    params.set("page", String(p));
    return `/admin/audit-log?${params.toString()}`;
  };

  const input =
    "rounded border border-border bg-background px-2.5 py-1.5 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <>
      <PageHeader
        title="Audit Log"
        description="Every governed action across the system, newest first. Append-only — entries can never be edited or deleted, by anyone, through any code path."
        action={<PrintButton label="Print this page" />}
      />

      {error && (
        <ErrorPanel>{error}</ErrorPanel>
      )}

      {/* GET form → filters live in the URL, so a filtered view is shareable
          and the back button behaves. No client state needed. */}
      <Panel className="mb-5 p-4 print:hidden">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="action" className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
              Action
            </label>
            <select id="action" name="action" defaultValue={searchParams.action ?? ""} className={input}>
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="actor" className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
              Actor contains
            </label>
            <input id="actor" name="actor" type="text" defaultValue={searchParams.actor ?? ""} placeholder="user id…" className={input} />
          </div>
          <div>
            <label htmlFor="from" className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
              From
            </label>
            <input id="from" name="from" type="date" defaultValue={searchParams.from ?? ""} className={`${input} font-mono`} />
          </div>
          <div>
            <label htmlFor="to" className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
              To
            </label>
            <input id="to" name="to" type="date" defaultValue={searchParams.to ?? ""} className={`${input} font-mono`} />
          </div>
          <button type="submit" className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            Apply filters
          </button>
          <Link href="/admin/audit-log" className="rounded border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text">
            Clear
          </Link>
        </form>
      </Panel>

      <Panel className="print-area">
        <PanelHeader
          title={`Entries · ${total.toLocaleString()}`}
          action={
            <span className="font-mono text-xs text-text-muted">
              {total === 0 ? "no matches" : `showing ${first}–${last}`}
            </span>
          }
        />
        {rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-text-muted">
            No audit entries match these filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-medium">Timestamp (UTC)</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Actor</th>
                  <th className="px-4 py-3 font-medium">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-raised/50">
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-text-muted">
                      {fmt(r.timestamp)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-text">
                        {r.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-text-muted">
                      {r.actorUserId}
                    </td>
                    <td className="max-w-md truncate px-4 py-2.5 font-mono text-xs text-text-muted">
                      {r.targetEntity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 print:hidden">
            <span className="font-mono text-xs text-text-muted">
              page {q.page} of {pages}
            </span>
            <div className="flex items-center gap-2">
              {q.page > 1 && (
                <Link href={pageHref(q.page - 1)} className="rounded border border-border px-2.5 py-1 text-xs text-text hover:bg-surface-raised">
                  ← Previous
                </Link>
              )}
              {q.page < pages && (
                <Link href={pageHref(q.page + 1)} className="rounded border border-border px-2.5 py-1 text-xs text-text hover:bg-surface-raised">
                  Next →
                </Link>
              )}
            </div>
          </div>
        )}

        <p className="border-t border-border px-4 py-3 text-xs text-text-muted print:hidden">
          Paginated server-side — each page fetches only its own {q.pageSize} rows
          from the database, never the whole table.
        </p>
      </Panel>
    </>
  );
}
