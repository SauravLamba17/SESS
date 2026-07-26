"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";

export interface TaskView {
  id: string;
  taskName: string;
  completed: boolean;
  completedAt: string | null;
}

/** A checklist, deliberately — no dependencies, assignees or due dates. */
export function OnboardingChecklist({
  employeeId,
  tasks,
}: {
  employeeId: string;
  tasks: TaskView[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [newTask, setNewTask] = useState("");
  const [error, setError] = useState<string | null>(null);

  function post(body: Record<string, unknown>) {
    setError(null);
    start(async () => {
      try {
        const res = await fetch("/api/hr/onboarding-task", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed");
          return;
        }
        setNewTask("");
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  const done = tasks.filter((t) => t.completed).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-muted">
          {done} of {tasks.length} complete
        </span>
        {pending && <Loader2 size={13} className="animate-spin text-text-muted" />}
      </div>

      {tasks.length > 0 && (
        <ul className="space-y-1.5">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <input
                id={`task-${t.id}`}
                type="checkbox"
                checked={t.completed}
                disabled={pending}
                onChange={(e) =>
                  post({ action: "toggle", id: t.id, completed: e.target.checked })
                }
                className="h-4 w-4 shrink-0 rounded border-border bg-background accent-good"
              />
              <label
                htmlFor={`task-${t.id}`}
                className={`flex-1 cursor-pointer text-sm ${
                  t.completed ? "text-text-muted line-through" : "text-text"
                }`}
              >
                {t.taskName}
              </label>
              {t.completedAt && (
                <span className="font-mono text-[10px] text-text-muted">
                  {t.completedAt}
                </span>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={() => post({ action: "remove", id: t.id })}
                aria-label={`Remove ${t.taskName}`}
                className="shrink-0 rounded p-1 text-text-muted hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <input
          type="text"
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newTask.trim())
              post({ action: "add", employeeId, taskName: newTask.trim() });
          }}
          placeholder="Add a task…"
          className="flex-1 rounded border border-border bg-background px-2.5 py-1.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <button
          type="button"
          disabled={pending || !newTask.trim()}
          onClick={() => post({ action: "add", employeeId, taskName: newTask.trim() })}
          className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1.5 text-xs text-text hover:bg-surface-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          <Plus size={13} /> Add
        </button>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
