import { PageHeader } from "@/components/portal/page-header";
import { ErrorPanel } from "@/components/ui/notice";
import { AppraisalFormulaForm } from "@/components/admin/appraisal-formula-form";
import { db } from "@/lib/db";
import { resolveFormula, ZERO_WEIGHTS, type ResolvedFormula } from "@/lib/appraisal/formula-config";

export const dynamic = "force-dynamic";

/**
 * Server-side initial load, matching every other interactive page in the app:
 * Prisma fetch → props → client sub-component.
 *
 * This page used to be the sole exception, rendering an empty shell and then
 * fetching its own first paint from /api/admin/appraisal-formula in a
 * useEffect. That cost a visible empty state on every visit and made the page
 * the only one whose first render could not be reasoned about server-side.
 *
 * Role enforcement is unchanged and does not live here: the /admin layout gates
 * the route to SUPER_ADMIN and the API re-checks on every read and write.
 */
async function load(): Promise<{ initial: ResolvedFormula; error: string | null }> {
  try {
    // The global default (department null) — the same thing the client used to
    // request on mount with an empty department.
    return { initial: await resolveFormula(db, null), error: null };
  } catch (err) {
    console.error("[admin/appraisal-formula] load failed:", err);
    return {
      initial: {
        department: null,
        weights: ZERO_WEIGHTS,
        source: "none",
        configured: false,
      },
      error: "The saved formula could not be loaded. Nothing has been changed.",
    };
  }
}

export default async function AppraisalFormulaPage() {
  const { initial, error } = await load();

  return (
    <>
      <PageHeader
        title="Appraisal Formula"
        description="Define the quality-linked appraisal formula and its component weights."
      />
      {error && <ErrorPanel>{error}</ErrorPanel>}
      <AppraisalFormulaForm initial={initial} />
    </>
  );
}
