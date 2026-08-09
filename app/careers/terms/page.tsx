import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import {
  HR_CONTACT_EMAIL,
  RETENTION_STATEMENT_YEARS,
  TERMS_VERSION,
} from "@/lib/recruitment/terms";

export const metadata = {
  title: "Terms & Conditions — SESS Careers",
  description:
    "What we collect from job applicants, why, how long we keep it, and how to have it deleted.",
};

/**
 * PUBLIC terms page for job applicants.
 *
 * ─── HOW THIS IS REACHABLE WITHOUT SIGNING IN ────────────────────────────
 * No middleware change was needed. middleware.ts's isPublicRoute already
 * matches "/careers(.*)", the wildcard added in Phase 8 when the career
 * surface was first opened up — /careers/terms falls inside it exactly as
 * /careers/[requisitionId] does. Nothing was broadened, so no other route's
 * protection could have changed.
 *
 * It renders inside app/careers/layout.tsx, which is deliberately NOT the
 * portal shell: no sidebar, no user button, nothing that would query Clerk or
 * hint that an internal app exists behind it.
 *
 * Static by design — it reads no request data and touches no database, so
 * there is no `dynamic = "force-dynamic"` here (unlike the listing pages,
 * which query live requisitions).
 */
export default function CareersTermsPage() {
  return (
    <>
      <Link
        href="/careers"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text"
      >
        <ArrowLeft size={13} /> Back to careers
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text">Terms &amp; Conditions</h1>
        <p className="mt-2 text-sm text-text-muted">
          What we collect when you apply, why we collect it, and how to have it
          removed.
        </p>
        <p className="mt-2 font-mono text-[11px] text-text-muted">
          Version {TERMS_VERSION}
        </p>
      </div>

      <Panel className="p-6">
        <section>
          <h2 className="text-sm font-semibold text-text">What we collect</h2>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            When you submit an application we collect your name, your email
            address, your phone number, and the resume file you upload.
          </p>
        </section>

        <section className="mt-6 border-t border-border pt-6">
          <h2 className="text-sm font-semibold text-text">Why we collect it</h2>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            To evaluate the specific application you submitted. Your resume is
            read by a person on our team — applications are not scored or
            filtered by software.
          </p>
        </section>

        <section className="mt-6 border-t border-border pt-6">
          <h2 className="text-sm font-semibold text-text">How long we keep it</h2>
          {/* One template literal, not a JSX interpolation: React would
              otherwise split this into three text nodes separated by comment
              markers, leaving a sentence that reads correctly but is awkward
              to select, translate or assert on. */}
          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            {`Your data is retained for ${RETENTION_STATEMENT_YEARS} year.`}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            If you are not selected, your details are placed on a review list
            after that period. Nothing is deleted automatically — a person
            reviews and decides, so that data still needed for a live
            conversation is not destroyed silently.
          </p>
        </section>

        <section className="mt-6 border-t border-border pt-6">
          <h2 className="text-sm font-semibold text-text">
            Your right to request deletion
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            You can ask us to delete your data at any time, without giving a
            reason and without waiting for the retention period to end. Contact
            us at the address below and we will remove your application, your
            contact details and your resume file.
          </p>
        </section>

        <section className="mt-6 border-t border-border pt-6">
          <h2 className="text-sm font-semibold text-text">Contact</h2>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            For any question about your data, or to request its deletion, write
            to{" "}
            <a
              href={`mailto:${HR_CONTACT_EMAIL}`}
              className="font-mono text-accent underline underline-offset-2 hover:opacity-80"
            >
              {HR_CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      </Panel>

      <p className="mt-6 text-xs text-text-muted">
        <Link href="/careers" className="text-accent underline underline-offset-2">
          Back to careers
        </Link>
      </p>
    </>
  );
}
