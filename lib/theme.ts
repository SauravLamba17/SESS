// Theme constants and resolution. Pure — no DOM, no React, importable
// anywhere including the inline pre-paint script's source of truth.

/** What the user PICKS. "system" is a mode, not a theme. */
export type ThemeMode = "dark" | "light" | "high-contrast" | "system";

/** What actually lands on <html data-theme="…">. "system" never appears here. */
export type ResolvedTheme = "dark" | "light" | "high-contrast";

export const THEME_STORAGE_KEY = "sess-theme";

export const THEME_MODES: { mode: ThemeMode; label: string; hint: string }[] = [
  { mode: "dark", label: "Dark", hint: "The default instrument-panel palette" },
  { mode: "light", label: "Light", hint: "Clean White — for bright rooms and printing" },
  { mode: "high-contrast", label: "High Contrast", hint: "Maximum legibility, thicker borders" },
  { mode: "system", label: "System", hint: "Follows your operating system" },
];

export function isThemeMode(v: unknown): v is ThemeMode {
  return v === "dark" || v === "light" || v === "high-contrast" || v === "system";
}

/**
 * Turn a chosen mode into the theme to apply.
 *
 * "system" resolves against prefers-color-scheme, which only distinguishes
 * light from dark — there is no OS signal for "high contrast" that maps onto
 * our third theme, so system never selects it. Choosing high contrast is
 * always an explicit act.
 */
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

/**
 * The script that runs BEFORE first paint, inlined into <head>.
 *
 * Kept as a string here rather than a real module because it must execute
 * synchronously before the browser paints anything — a hydrated React effect
 * would run after, producing a visible flash of the wrong theme on every
 * navigation into the app.
 *
 * Deliberately defensive: a browser with localStorage disabled (or a corrupt
 * value) must still render a usable app rather than throwing during head
 * execution, so everything is wrapped and falls back to dark.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var mode = (stored === 'dark' || stored === 'light' || stored === 'high-contrast' || stored === 'system')
      ? stored
      : 'dark';
    var theme = mode;
    if (mode === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`.trim();
