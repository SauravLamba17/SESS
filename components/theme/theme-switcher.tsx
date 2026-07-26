"use client";

import { useEffect, useState, useCallback } from "react";
import { Monitor, Moon, Sun, Contrast, Check } from "lucide-react";
import {
  THEME_MODES,
  THEME_STORAGE_KEY,
  isThemeMode,
  resolveTheme,
  type ThemeMode,
} from "@/lib/theme";

const ICONS: Record<ThemeMode, typeof Moon> = {
  dark: Moon,
  light: Sun,
  "high-contrast": Contrast,
  system: Monitor,
};

/**
 * Theme picker for the portal topbar.
 *
 * The chosen MODE is persisted; the RESOLVED theme goes on <html data-theme>.
 * The inline script in app/layout.tsx has already applied the correct theme
 * before this component ever mounts, so this only handles changes — it never
 * causes the initial paint.
 *
 * Persisted in localStorage rather than the database: this is a per-device
 * display preference, not account data. Someone using the shop-floor terminal
 * in a bright room and their own laptop at night wants different answers, and
 * syncing it would fight them.
 */
export function ThemeSwitcher() {
  const [mode, setMode] = useState<ThemeMode>("dark");
  const [open, setOpen] = useState(false);
  // Rendered only after mount: the server cannot know the stored preference,
  // so showing the real icon before hydration would guarantee a mismatch.
  const [ready, setReady] = useState(false);

  const apply = useCallback((next: ThemeMode) => {
    const prefersDark = !window.matchMedia("(prefers-color-scheme: light)").matches;
    document.documentElement.setAttribute("data-theme", resolveTheme(next, prefersDark));
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    const initial: ThemeMode = isThemeMode(stored) ? stored : "dark";
    setMode(initial);
    setReady(true);
  }, []);

  // Re-resolve when the OS flips, but only while following the system.
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode, apply]);

  // Keep multiple open tabs in step.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY || !isThemeMode(e.newValue)) return;
      setMode(e.newValue);
      apply(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [apply]);

  function choose(next: ThemeMode) {
    setMode(next);
    setOpen(false);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode / storage disabled — the theme still applies for this
      // session, it just will not survive a reload. Not worth an error.
    }
    apply(next);
  }

  const Icon = ICONS[mode];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${THEME_MODES.find((t) => t.mode === mode)?.label ?? "Dark"}`}
        title="Change theme"
        className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {ready ? <Icon size={14} /> : <Monitor size={14} className="opacity-0" />}
      </button>

      {open && (
        <>
          {/* Click-away. Sits under the menu, over everything else. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-1.5 w-60 rounded border border-border bg-surface p-1 shadow-panel"
          >
            <p className="px-2.5 py-1.5 text-[10px] uppercase tracking-wide text-text-muted">
              Appearance
            </p>
            {THEME_MODES.map((t) => {
              const ItemIcon = ICONS[t.mode];
              const active = t.mode === mode;
              return (
                <button
                  key={t.mode}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => choose(t.mode)}
                  className={`flex w-full items-start gap-2.5 rounded px-2.5 py-2 text-left text-xs transition-colors ${
                    active
                      ? "bg-surface-raised text-text"
                      : "text-text-muted hover:bg-surface-raised/60 hover:text-text"
                  }`}
                >
                  <ItemIcon size={13} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block">{t.label}</span>
                    <span className="block text-[10px] text-text-muted">{t.hint}</span>
                  </span>
                  {active && <Check size={13} className="mt-0.5 shrink-0 text-accent" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
