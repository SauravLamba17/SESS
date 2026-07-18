import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // SESS instrument-panel palette (graphite base, sparing amber).
        background: "#0F1417",
        surface: "#171D21",
        "surface-raised": "#1E262B",
        border: "#2A333A",
        text: "#E8ECEE",
        "text-muted": "#8B98A1",
        accent: "#F5A623", // amber — used sparingly
        good: "#2BB673",
        danger: "#E5484D",
        info: "#4C9FE8",
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
      boxShadow: {
        panel:
          "0 1px 0 0 rgba(255,255,255,0.02) inset, 0 1px 2px rgba(0,0,0,0.4)",
      },
    },
  },
  plugins: [],
};
export default config;
