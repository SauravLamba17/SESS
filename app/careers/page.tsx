import Link from "next/link";
import { ArrowRight, Briefcase } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { getOpenRoles } from "@/lib/cache/dashboard";
import { ErrorPanel } from "@/components/ui/notice";

export const dynamic = "force-dynamic";

async function load() {
  try {
    // OPEN only. ON_HOLD and CLOSED roles are never shown publicly, and the
    // submission endpoint re-checks status server-side regardless — so a
    // cached listing can never let an application through to a closed role.
    //
    // YELLOW TIER (SESS_Caching_Strategy.docx §2/§4), 5 min. This is the ONE
    // unauthenticated read in SESS, which is exactly why it is the one that
    // may safely be cached at a shared layer at all (§8).
    const requisitions = await getOpenRoles();
    return { requisitions, error: null };
  } catch (err) {
    console.error("[careers] failed:", err);
    return { requisitions: [], error: "Job listings are unavailable right now." };
  }
}

export default async function CareersPage() {
  const { requisitions, error } = await load();

  const byDept = new Map<string, typeof requisitions>();
  for (const r of requisitions) {
    const arr = byDept.get(r.department) ?? [];
    arr.push(r);
    byDept.set(r.department, arr);
  }

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-text">Open Positions</h1>
        <p className="mt-2 max-w-2xl text-sm text-text-muted">
          We&apos;re hiring. Browse the roles below and apply with your resume —
          a member of our team reads every application.
        </p>
      </div>

      {error && (
        <ErrorPanel>{error}</ErrorPanel>
      )}

      {requisitions.length === 0 && !error ? (
        <Panel className="px-6 py-12 text-center">
          <Briefcase size={28} className="mx-auto mb-3 text-text-muted" />
          <p className="text-sm text-text">No open positions right now.</p>
          <p className="mt-1 text-xs text-text-muted">
            Please check back — we post new roles as they open.
          </p>
        </Panel>
      ) : (
        <div className="space-y-8">
          {Array.from(byDept.entries()).map(([department, roles]) => (
            <section key={department}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                {department}
              </h2>
              <div className="space-y-3">
                {roles.map((r) => (
                  <Panel key={r.id} className="p-5 transition-colors hover:border-accent/50">
                    <Link href={`/careers/${r.id}`} className="block">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <h3 className="text-base font-semibold text-text">{r.title}</h3>
                          <p className="mt-1 line-clamp-2 text-sm text-text-muted">
                            {r.description}
                          </p>
                          <p className="mt-2 font-mono text-[11px] text-text-muted">
                            {r.openings} opening{r.openings === 1 ? "" : "s"}
                          </p>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-accent">
                          View &amp; apply <ArrowRight size={13} />
                        </span>
                      </div>
                    </Link>
                  </Panel>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
