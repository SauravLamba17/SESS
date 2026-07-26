import type { Config } from "tailwindcss";

/**
 * Colours are CSS CUSTOM PROPERTIES, not literal hexes.
 *
 * Every one of the ~1,400 utility usages already written across the app
 * (`bg-surface`, `text-text-muted`, `border-border`, …) keeps working
 * unchanged — the class name still resolves to the same token, but the token
 * now reads a variable that app/globals.css redefines per [data-theme]. That
 * is what makes four themes switchable at runtime without touching a single
 * page's className.
 *
 * The `<alpha-value>` placeholder keeps Tailwind's opacity modifiers working
 * (`bg-accent/10`, `border-danger/40`), which the codebase uses heavily. It
 * requires the variables to be defined as raw R G B channel triplets rather
 * than `#rrggbb` — see globals.css.
 */
const withAlpha = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: withAlpha("--color-base"),
        surface: withAlpha("--color-surface"),
        "surface-raised": withAlpha("--color-surface-raised"),
        border: withAlpha("--color-border"),
        text: withAlpha("--color-text"),
        "text-muted": withAlpha("--color-text-muted"),
        accent: withAlpha("--color-accent"),
        good: withAlpha("--color-good"),
        // `warn` was USED in 24 places across 13 files but never defined here,
        // so every `text-warn` / `border-warn` silently produced nothing.
        // Defining it fixes those; it is part of the theme spec regardless.
        warn: withAlpha("--color-warn"),
        danger: withAlpha("--color-danger"),
        info: withAlpha("--color-info"),
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        // Small, deliberate — panel aesthetic, not rounded consumer cards.
        none: "0",
        sm: "2px",
        DEFAULT: "4px",
        md: "4px",
        lg: "4px",
        xl: "4px",
        "2xl": "4px",
        full: "9999px",
      },
      borderWidth: {
        // High-contrast mode thickens hairlines via this variable; every other
        // theme sets it to 1px, so nothing changes visually for them.
        DEFAULT: "var(--border-width, 1px)",
      },
      boxShadow: {
        panel: "var(--shadow-panel)",
      },
    },
  },
  plugins: [],
};
export default config;
