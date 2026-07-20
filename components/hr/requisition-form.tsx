"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent";

export function RequisitionForm({
  initial,
}: {
  initial?: {
    id: string;
    title: string;
    department: string;
    description: string;
    openings: number;
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [department, setDepartment] = useState(initial?.department ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [openings, setOpenings] = useState(String(initial?.openings ?? 1));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save() {
    setError(null);
    setSaved(false);
    if (!title.trim() || !department.trim() || !description.trim()) {
      setError("Title, department and description are all required.");
      return;
    }
    const n = Number.parseInt(openings, 10);
    if (!Number.isFinite(n) || n < 1) {
      setError("Openings must be a whole number of at least 1.");
      return;
    }
    start(async () => {
      try {
        const res = await fetch("/api/hr/requisition", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(initial ? { id: initial.id } : {}),
            title: title.trim(),
            department: department.trim(),
            description: description.trim(),
            openings: n,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not save.");
          return;
        }
        setSaved(true);
        if (!initial) {
          setTitle("");
          setDepartment("");
          setDescription("");
          setOpenings("1");
        }
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            Job title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Production Supervisor"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            Openings
          </label>
          <input
            type="number"
            min={1}
            value={openings}
            onChange={(e) => setOpenings(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
          Department
        </label>
        <input
          type="text"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          placeholder="Assembly"
          className={inputClass}
        />
        <p className="mt-1 text-[10px] text-text-muted">
          Managers in this department will be able to see these candidates and
          add interview feedback.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
          Description
        </label>
        <textarea
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What the role involves, what you're looking for…"
          className={inputClass}
        />
        <p className="mt-1 text-[10px] text-text-muted">
          Shown publicly on the career page.
        </p>
      </div>

      <div className="flex items-center justify-end gap-2">
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-good">
            <CheckCircle2 size={13} /> Saved
          </span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {pending && <Loader2 size={13} className="animate-spin" />}
          {initial ? "Update requisition" : "Create requisition"}
        </button>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
