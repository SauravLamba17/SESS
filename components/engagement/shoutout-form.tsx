"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Megaphone, Trash2 } from "lucide-react";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent";

const MAX = 500;

export function ShoutOutForm({
  people,
}: {
  people: { id: string; name: string; department: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [toEmployeeId, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  function post() {
    setError(null);
    if (!toEmployeeId) {
      setError("Choose who this is for.");
      return;
    }
    if (!message.trim()) {
      setError("Write a message.");
      return;
    }
    start(async () => {
      try {
        const res = await fetch("/api/community/shoutout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toEmployeeId, message: message.trim() }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not post.");
          return;
        }
        setTo("");
        setMessage("");
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  const byDept = new Map<string, typeof people>();
  for (const p of people) {
    const arr = byDept.get(p.department) ?? [];
    arr.push(p);
    byDept.set(p.department, arr);
  }

  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor="shoutout-to"
          className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted"
        >
          Who deserves a shout-out?
        </label>
        <select
          id="shoutout-to"
          value={toEmployeeId}
          onChange={(e) => setTo(e.target.value)}
          className={inputClass}
        >
          <option value="">Choose someone…</option>
          {Array.from(byDept.entries()).map(([dept, list]) => (
            <optgroup key={dept} label={dept}>
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="shoutout-msg"
          className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted"
        >
          What did they do?
        </label>
        <textarea
          id="shoutout-msg"
          rows={3}
          maxLength={MAX}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Stayed back to help finish the Wednesday run…"
          className={inputClass}
        />
        <p className="mt-1 text-right font-mono text-[10px] text-text-muted">
          {message.length}/{MAX}
        </p>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <button
        type="button"
        onClick={post}
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
      >
        {pending ? <Loader2 size={15} className="animate-spin" /> : <Megaphone size={15} />}
        Post shout-out
      </button>
      <p className="text-[10px] text-text-muted">
        Visible to everyone. You can delete your own post within 15 minutes.
      </p>
    </div>
  );
}

/** Delete-own control, shown only on your own recent posts. */
export function DeleteShoutOutButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    setError(null);
    start(async () => {
      try {
        const res = await fetch("/api/community/shoutout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", id }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not delete.");
          router.refresh();
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
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        aria-label="Delete my shout-out"
        className="rounded p-1 text-text-muted hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
      >
        {pending ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
      </button>
      {error && <span className="text-[10px] text-danger">{error}</span>}
    </span>
  );
}
