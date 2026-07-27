"use client";

import { isDateOnly } from "@/lib/period";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, Loader2, Lock } from "lucide-react";
import { inr } from "@/lib/payroll/format";

const inputClass =
  "w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent";

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

export interface OfferView {
  id: string;
  status: "DRAFT" | "APPROVED" | "SENT" | "ACCEPTED" | "DECLINED" | "WITHDRAWN";
  proposedBasic: string;
  proposedHra: string;
  proposedSpecialAllowance: string;
  proposedDesignation: string;
  proposedDepartment: string;
  proposedManagerId: string | null;
  joiningDate: string;
  approvedAt: string | null;
  sentAt: string | null;
  respondedAt: string | null;
}

/**
 * Offer creation and lifecycle.
 *
 * Editing is only offered while DRAFT. Once APPROVED, and permanently once
 * SENT, the figures are read-only here — and the server rejects an edit with
 * 409 regardless of what this component renders.
 */
export function OfferPanel({
  applicationId,
  stage,
  offer,
  managers,
  defaultDepartment,
  candidateName,
}: {
  applicationId: string;
  stage: string;
  offer: OfferView | null;
  managers: { id: string; name: string; employeeCode: string }[];
  defaultDepartment: string;
  /** Needed for the attestation record when HR records the response. */
  candidateName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [basic, setBasic] = useState(offer?.proposedBasic ?? "");
  const [hra, setHra] = useState(offer?.proposedHra ?? "");
  const [special, setSpecial] = useState(offer?.proposedSpecialAllowance ?? "");
  const [designation, setDesignation] = useState(offer?.proposedDesignation ?? "");
  const [department, setDepartment] = useState(offer?.proposedDepartment ?? defaultDepartment);
  const [managerId, setManagerId] = useState(offer?.proposedManagerId ?? "");
  const [joiningDate, setJoiningDate] = useState(offer?.joiningDate ?? "");
  // Which candidate response HR is recording, and the name they type for it.
  const [responding, setResponding] = useState<"ACCEPTED" | "DECLINED" | null>(null);
  const [attestedName, setAttestedName] = useState("");
  // Opt-in: send the new employee a Clerk login invitation on hire.
  const [sendInvitation, setSendInvitation] = useState(true);

  const editable = !offer || offer.status === "DRAFT";
  const locked = offer && (offer.status === "SENT" || offer.status === "ACCEPTED");

  const ctc =
    [basic, hra, special].every((v) => MONEY.test(v.trim()))
      ? (Number(basic) + Number(hra) + Number(special)).toFixed(2)
      : null;

  function saveOffer() {
    setError(null);
    setSaved(null);
    if (![basic, hra, special].every((v) => MONEY.test(v.trim()))) {
      setError("Basic, HRA and Special Allowance must be amounts like 30000 or 30000.50.");
      return;
    }
    if (Number(basic) <= 0) {
      setError("Basic must be greater than zero.");
      return;
    }
    if (!designation.trim() || !department.trim()) {
      setError("Designation and department are required.");
      return;
    }
    if (!isDateOnly(joiningDate)) {
      setError("Choose a joining date.");
      return;
    }
    start(async () => {
      try {
        const res = await fetch("/api/hr/offer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            applicationId,
            proposedBasic: basic.trim(),
            proposedHra: hra.trim(),
            proposedSpecialAllowance: special.trim(),
            proposedDesignation: designation.trim(),
            proposedDepartment: department.trim(),
            proposedManagerId: managerId || null,
            joiningDate,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not save the offer.");
          router.refresh();
          return;
        }
        setSaved("Offer saved as DRAFT — a Super Admin must approve it next.");
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  function advance(status: string, label: string, attestedName?: string) {
    setError(null);
    setSaved(null);
    start(async () => {
      try {
        const res = await fetch("/api/hr/offer/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: offer!.id,
            status,
            ...(attestedName ? { attestedName } : {}),
            ...(status === "ACCEPTED" ? { sendInvitation } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed");
          router.refresh();
          return;
        }
        setSaved(
          status === "ACCEPTED"
            ? `Hired. Employee ${data.employeeCode} created with a salary structure and ${data.onboardingTasksCreated} onboarding tasks.` +
              (!data.invitation
                ? ""
                : data.invitation.sent
                  ? " Login invitation sent."
                  : ` Login invitation FAILED: ${data.invitation.error} — retry from the Employee Master roster.`)
            : label,
        );
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  if (stage !== "OFFER" && !offer) {
    return (
      <p className="text-sm text-text-muted">
        Move this candidate to the <span className="text-text">OFFER</span> stage
        to raise an offer.
      </p>
    );
  }

  const btn =
    "inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 disabled:opacity-50";

  return (
    <div className="space-y-4">
      {offer && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded border border-accent/40 bg-accent/10 px-2 py-0.5 font-medium uppercase text-accent">
            {offer.status}
          </span>
          {/* The letter is only issuable once a Super Admin has approved the
              figures. On a DRAFT the server refuses with 409 regardless, so
              this shows an explanation rather than a dead button. */}
          {["APPROVED", "SENT", "ACCEPTED", "DECLINED"].includes(offer.status) ? (
            <a
              href={`/api/hr/offer/letter/${offer.id}`}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-text-muted hover:bg-surface-raised hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Download size={12} /> Offer letter (PDF)
            </a>
          ) : offer.status === "DRAFT" ? (
            <span className="text-text-muted">
              Offer letter available once approved
            </span>
          ) : null}
          {offer.approvedAt && (
            <span className="text-text-muted">approved {offer.approvedAt}</span>
          )}
          {offer.sentAt && <span className="text-text-muted">sent {offer.sentAt}</span>}
          {offer.respondedAt && (
            <span className="text-text-muted">responded {offer.respondedAt}</span>
          )}
        </div>
      )}

      {locked && (
        <p className="flex items-start gap-2 rounded border border-border bg-surface-raised/40 px-3 py-2 text-[11px] text-text-muted">
          <Lock size={13} className="mt-0.5 shrink-0" />
          <span>
            These figures are locked. Once an offer is SENT the terms are
            immutable through every code path — withdraw it and raise a new
            offer if the terms must change.
          </span>
        </p>
      )}

      <div className="grid grid-cols-3 gap-3">
        {(
          [
            ["Basic", basic, setBasic],
            ["HRA", hra, setHra],
            ["Special Allow.", special, setSpecial],
          ] as const
        ).map(([label, value, set]) => (
          <div key={label}>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
              {label}
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={value}
              disabled={!editable}
              onChange={(e) => set(e.target.value)}
              className={`${inputClass} font-mono disabled:opacity-60`}
            />
          </div>
        ))}
      </div>

      {ctc && (
        <p className="font-mono text-xs text-text-muted">
          Monthly gross ₹{inr(ctc)} · annual ₹{inr((Number(ctc) * 12).toFixed(2))}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            Designation
          </label>
          <input
            type="text"
            value={designation}
            disabled={!editable}
            onChange={(e) => setDesignation(e.target.value)}
            className={`${inputClass} disabled:opacity-60`}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            Department
          </label>
          <input
            type="text"
            value={department}
            disabled={!editable}
            onChange={(e) => setDepartment(e.target.value)}
            className={`${inputClass} disabled:opacity-60`}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            Reports to
          </label>
          <select
            value={managerId}
            disabled={!editable}
            onChange={(e) => setManagerId(e.target.value)}
            className={`${inputClass} disabled:opacity-60`}
          >
            <option value="">No manager</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.employeeCode}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            Joining date
          </label>
          <input
            type="date"
            value={joiningDate}
            disabled={!editable}
            onChange={(e) => setJoiningDate(e.target.value)}
            className={`${inputClass} font-mono disabled:opacity-60`}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        {pending && <Loader2 size={14} className="animate-spin text-text-muted" />}

        {editable && (
          <button
            type="button"
            onClick={saveOffer}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            {offer ? "Update draft offer" : "Create draft offer"}
          </button>
        )}

        {offer?.status === "DRAFT" && (
          <span className="text-[11px] text-text-muted">
            Awaiting Super Admin approval — HR cannot approve its own offer.
          </span>
        )}

        {offer?.status === "APPROVED" && (
          <button
            type="button"
            onClick={() => advance("SENT", "Offer marked as sent.")}
            disabled={pending}
            className={`${btn} border-good/40 text-good hover:bg-good/10 focus-visible:ring-good`}
          >
            Mark as sent
          </button>
        )}

        {offer?.status === "SENT" && !responding && (
          <>
            <button
              type="button"
              onClick={() => setResponding("ACCEPTED")}
              disabled={pending}
              className={`${btn} border-good/40 text-good hover:bg-good/10 focus-visible:ring-good`}
            >
              Candidate accepted → hire
            </button>
            <button
              type="button"
              onClick={() => setResponding("DECLINED")}
              disabled={pending}
              className={`${btn} border-danger/40 text-danger hover:bg-danger/10 focus-visible:ring-danger`}
            >
              Candidate declined
            </button>
          </>
        )}

        {offer && ["DRAFT", "APPROVED", "SENT"].includes(offer.status) && (
          <button
            type="button"
            onClick={() => advance("WITHDRAWN", "Offer withdrawn.")}
            disabled={pending}
            className={`${btn} border-border text-text-muted hover:text-text`}
          >
            Withdraw
          </button>
        )}
      </div>

      {/* ATTESTATION RECORD — HR recording the candidate's response.
          Distinct from the employee case: HR types the CANDIDATE's name, so
          this evidences HR's data entry, not the candidate's own act. */}
      {responding && (
        <div className="rounded border border-accent/40 bg-accent/5 p-3">
          <p className="text-xs font-medium text-accent">Attestation Record</p>
          <p className="mt-0.5 text-[10px] text-text-muted">
            (internal record, not a legal digital signature)
          </p>
          <p className="mt-2 text-[11px] text-text-muted">
            You are recording that <span className="text-text">{candidateName}</span>{" "}
            {responding === "ACCEPTED" ? "accepted" : "declined"} this offer.
            Type their full name to confirm what you were told. Your user id, the
            time and your IP are recorded alongside it — this is a record of your
            data entry on the candidate&apos;s behalf, not of their own signature.
          </p>
          <input
            type="text"
            value={attestedName}
            onChange={(e) => setAttestedName(e.target.value)}
            placeholder={candidateName}
            autoComplete="off"
            className={`${inputClass} mt-2`}
          />
          {responding === "ACCEPTED" && (
            <label className="mt-2 flex items-center gap-2 text-[11px] text-text-muted">
              <input
                type="checkbox"
                checked={sendInvitation}
                onChange={(e) => setSendInvitation(e.target.checked)}
              />
              Send a SESS login invitation to the candidate&apos;s email (as Employee)
            </label>
          )}
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setResponding(null);
                setAttestedName("");
              }}
              disabled={pending}
              className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:text-text"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending || !attestedName.trim()}
              onClick={() =>
                advance(
                  responding,
                  responding === "ACCEPTED" ? "Accepted." : "Offer declined.",
                  attestedName.trim(),
                )
              }
              className={`${btn} ${
                responding === "ACCEPTED"
                  ? "border-good/40 text-good hover:bg-good/10 focus-visible:ring-good"
                  : "border-danger/40 text-danger hover:bg-danger/10 focus-visible:ring-danger"
              }`}
            >
              {pending && <Loader2 size={13} className="animate-spin" />}
              Record {responding === "ACCEPTED" ? "acceptance" : "decline"}
            </button>
          </div>
        </div>
      )}

      {saved && (
        <p className="flex items-start gap-2 rounded border border-good/40 bg-good/10 px-3 py-2 text-xs text-good">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          {saved}
        </p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
