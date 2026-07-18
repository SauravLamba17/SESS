"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";
import {
  updateProfile,
  type ProfileFormState,
} from "@/app/employee/profile/actions";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent";

export function ProfileForm({
  initialName,
  initialEmergencyContact,
}: {
  initialName: string;
  initialEmergencyContact: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initialName);
  const [emergencyContact, setEmergencyContact] = useState(
    initialEmergencyContact,
  );
  const [state, setState] = useState<ProfileFormState | null>(null);
  const [success, setSuccess] = useState(false);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(false);
    if (!name.trim()) {
      setState({ ok: false, fieldErrors: { name: "Name cannot be empty." } });
      return;
    }
    startTransition(async () => {
      const res = await updateProfile({ name, emergencyContact });
      setState(res);
      if (res.ok) {
        setSuccess(true);
        router.refresh();
      }
    });
  }

  const fe = state?.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div>
        <label
          htmlFor="name"
          className="mb-1 block text-xs uppercase tracking-wide text-text-muted"
        >
          Full name
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          aria-invalid={!!fe.name}
        />
        {fe.name && <p className="mt-1 text-xs text-danger">{fe.name}</p>}
      </div>

      <div>
        <label
          htmlFor="emergencyContact"
          className="mb-1 block text-xs uppercase tracking-wide text-text-muted"
        >
          Emergency contact
        </label>
        <input
          id="emergencyContact"
          type="text"
          value={emergencyContact}
          onChange={(e) => setEmergencyContact(e.target.value)}
          placeholder="Name & phone number"
          className={inputClass}
        />
      </div>

      {state && !state.ok && state.error && (
        <div className="flex items-center gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <StatusDot state="danger" />
          <span>{state.error}</span>
        </div>
      )}

      {success && (
        <div
          className="flex items-center gap-2 rounded border border-good/40 bg-good/10 px-3 py-2 text-sm text-good"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 size={16} />
          <span>Profile saved.</span>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
      >
        {pending && <Loader2 size={16} className="animate-spin" />}
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
