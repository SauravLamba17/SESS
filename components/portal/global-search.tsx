"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, UserRound, UserSearch, Briefcase } from "lucide-react";

interface Hit {
  kind: "employee" | "candidate" | "requisition";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

const ICON = {
  employee: UserRound,
  candidate: UserSearch,
  requisition: Briefcase,
} as const;

const KIND_LABEL = {
  employee: "Employee",
  candidate: "Candidate",
  requisition: "Requisition",
} as const;

/**
 * Topbar search. Results are role-scoped SERVER-side by /api/search — this
 * component renders whatever it is given and knows nothing about roles, so
 * there is no client-side filter to bypass.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced fetch — one request per pause in typing, not per keystroke.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: ctl.signal,
        });
        const data = await res.json();
        setHits(res.ok ? (data.hits ?? []) : []);
        setOpen(true);
      } catch {
        // Aborted or offline — leave the last results alone.
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  // Click-away closes the dropdown.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function go(href: string) {
    setOpen(false);
    setQ("");
    setHits([]);
    router.push(href);
  }

  return (
    <div ref={boxRef} className="relative w-64 print:hidden">
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hits.length > 0 && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && hits.length > 0) go(hits[0].href);
          }}
          placeholder="Search…"
          aria-label="Search"
          className="w-full rounded border border-border bg-background py-1.5 pl-8 pr-8 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {loading && (
          <Loader2
            size={13}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-text-muted"
          />
        )}
      </div>

      {open && q.trim().length >= 2 && (
        <div className="absolute right-0 z-50 mt-1 w-96 overflow-hidden rounded border border-border bg-surface shadow-panel">
          {hits.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-text-muted">
              {loading ? "Searching…" : `No matches for “${q.trim()}”.`}
            </p>
          ) : (
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
              {hits.map((h) => {
                const Icon = ICON[h.kind];
                return (
                  <li key={`${h.kind}-${h.id}`}>
                    <button
                      type="button"
                      onClick={() => go(h.href)}
                      className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-surface-raised focus:outline-none focus-visible:bg-surface-raised"
                    >
                      <Icon size={14} className="mt-0.5 shrink-0 text-text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-text">{h.title}</span>
                        <span className="block truncate font-mono text-[11px] text-text-muted">
                          {h.subtitle}
                        </span>
                      </span>
                      <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-muted">
                        {KIND_LABEL[h.kind]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
