"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Upload } from "lucide-react";
import { TERMS_PATH } from "@/lib/recruitment/terms";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent";

const MAX_BYTES = 5 * 1024 * 1024;

export function ApplicationForm({ requisitionId }: { requisitionId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  // Gates the submit button. Mirrored server-side — see app/api/careers/apply.
  const [accepted, setAccepted] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const data = new FormData(form);
    data.set("requisitionId", requisitionId);

    // Client-side mirror of the server rules, for immediate feedback only —
    // the server re-checks all of this and is authoritative.
    const file = data.get("resume");
    if (!(file instanceof File) || file.size === 0) {
      setError("Please attach your resume as a PDF.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(
        `Your resume is ${(file.size / 1024 / 1024).toFixed(1)} MB — please upload a file of 5 MB or less.`,
      );
      return;
    }
    if (file.type && file.type !== "application/pdf") {
      setError("Resume must be a PDF file.");
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/careers/apply", { method: "POST", body: data });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "We could not submit your application. Please try again.");
        return;
      }
      setDone(true);
      form.reset();
      setFileName(null);
      setAccepted(false);
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div
        className="flex items-start gap-3 rounded border border-good/40 bg-good/10 px-4 py-3"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-good" />
        <div>
          <p className="text-sm font-medium text-good">Application received</p>
          <p className="mt-1 text-xs text-text-muted">
            Thank you. Someone from our team will read your resume and be in
            touch if there&apos;s a fit. You won&apos;t receive an automated
            score or rejection — a person reviews every application.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-4">
      {/* Honeypot: positioned off-screen rather than display:none, which some
          bots specifically skip. A real applicant never sees or fills this. */}
      <div aria-hidden className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="website">Leave this field empty</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="mb-1 block text-xs uppercase tracking-wide text-text-muted">
            Full name
          </label>
          <input id="name" name="name" type="text" required maxLength={120} className={inputClass} />
        </div>
        <div>
          <label htmlFor="phone" className="mb-1 block text-xs uppercase tracking-wide text-text-muted">
            Phone
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            required
            placeholder="+91 98765 43210"
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="email" className="mb-1 block text-xs uppercase tracking-wide text-text-muted">
          Email
        </label>
        <input id="email" name="email" type="email" required maxLength={200} className={inputClass} />
      </div>

      <div>
        <label htmlFor="resume" className="mb-1 block text-xs uppercase tracking-wide text-text-muted">
          Resume (PDF, max 5 MB)
        </label>
        <label
          htmlFor="resume"
          className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-border bg-background px-3 py-3 text-sm text-text-muted hover:border-accent"
        >
          <Upload size={15} />
          <span>{fileName ?? "Choose a PDF file…"}</span>
        </label>
        <input
          id="resume"
          name="resume"
          type="file"
          accept="application/pdf,.pdf"
          required
          className="sr-only"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        />
      </div>

      {/* REQUIRED acceptance. Unchecked by default and never pre-ticked — a
          pre-ticked box is not agreement. An unchecked checkbox submits
          NOTHING, so the server sees the field's absence and rejects the
          submission; the disabled button below is UX, not the control. */}
      <div className="rounded border border-border bg-surface-raised/40 p-3">
        <label htmlFor="termsAccepted" className="flex cursor-pointer items-start gap-2.5">
          <input
            id="termsAccepted"
            name="termsAccepted"
            type="checkbox"
            value="yes"
            required
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border bg-background accent-accent"
          />
          <span className="text-xs text-text">
            I have read and agree to the{" "}
            {/* New tab on purpose: this form holds an attached file and typed
                details that navigating away would discard. */}
            <Link
              href={TERMS_PATH}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-2 hover:opacity-80"
            >
              Terms and Conditions
            </Link>
          </span>
        </label>
      </div>

      {error && (
        <p className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !accepted}
        className="inline-flex items-center justify-center gap-2 rounded bg-accent px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
      >
        {pending && <Loader2 size={16} className="animate-spin" />}
        {pending ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
