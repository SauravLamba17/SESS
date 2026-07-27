"use client";

import { isDateOnly } from "@/lib/period";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Loader2, X } from "lucide-react";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent";

export function HolidayForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    if (!name.trim()) {
      setError("Enter the holiday name.");
      return;
    }
    if (!isDateOnly(date)) {
      setError("Choose the date.");
      return;
    }
    start(async () => {
      try {
        const res = await fetch("/api/hr/holiday", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "add", name: name.trim(), date }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not add.");
          return;
        }
        setName("");
        setDate("");
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
          Holiday name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Diwali"
          className={inputClass}
        />
      </div>
      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
          Date
        </label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={`${inputClass} font-mono`}
        />
        <p className="mt-1 text-[10px] text-text-muted">
          Enter the actual date for this year. Festival dates shift each year,
          so SESS never guesses them — add next year&apos;s dates when they&apos;re
          known.
        </p>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <button
        type="button"
        onClick={add}
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
      >
        {pending ? <Loader2 size={15} className="animate-spin" /> : <CalendarPlus size={15} />}
        Add holiday
      </button>
    </div>
  );
}

export function RemoveHolidayButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    setError(null);
    start(async () => {
      try {
        const res = await fetch("/api/hr/holiday", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "remove", id }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed");
          return;
        }
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-[10px] text-danger">{error}</span>}
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        aria-label={`Remove ${name}`}
        className="rounded p-1 text-text-muted hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
      >
        {pending ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
      </button>
    </span>
  );
}
