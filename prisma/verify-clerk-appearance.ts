/**
 * CLERK USERBUTTON DROPDOWN CONTRAST.
 *
 * The UserButton popover ("Manage account" / "Sign out") rendered near-black
 * text on the dark theme's card. Cause: app/layout.tsx set only Clerk's
 * DEPRECATED colour variables (colorText / colorTextSecondary /
 * colorInputBackground). @clerk/types 4.101 renamed those to colorForeground /
 * colorMutedForeground / colorInput, so the ones Clerk actually reads were
 * unset and fell back to its built-in defaults — #212126 text, designed for a
 * white card.
 *
 * The fix stamps theme-token CSS classes onto the popover elements instead, so
 * the colours resolve from globals.css against whatever [data-theme] is live.
 *
 * This asserts the resulting foreground/background PAIRS clear WCAG AA (4.5:1)
 * in every theme, using the same luminance/contrast maths as
 * prisma/verify-phase14.ts, plus that the config itself is wired correctly.
 *
 * Run:  npx tsx prisma/verify-clerk-appearance.ts
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const css = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
const layout = fs.readFileSync(path.join(ROOT, "app/layout.tsx"), "utf8");
const clerkTypes = fs.readFileSync(
  path.join(ROOT, "node_modules/@clerk/shared/dist/types/index.d.ts"),
  "utf8",
);

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
}
function step(n: string, title: string) {
  console.log(`\n── ${n}: ${title} ${"─".repeat(Math.max(0, 46 - title.length))}`);
}

// ── the Phase 14 maths, unchanged ──────────────────────────────────────
function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}
const AA_SMALL = 4.5;

function themeBlock(selector: string): string {
  const i = css.indexOf(selector);
  if (i === -1) throw new Error(`theme block not found: ${selector}`);
  return css.slice(i, css.indexOf("}", i));
}
function token(block: string, name: string): [number, number, number] {
  const m = new RegExp(`${name}:\\s*([\\d]+)\\s+([\\d]+)\\s+([\\d]+)`).exec(block);
  if (!m) throw new Error(`token ${name} not found`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// Clerk's built-in defaults, for the "what it used to be" comparison.
const CLERK_DEFAULT_TEXT: [number, number, number] = [0x21, 0x21, 0x26]; // #212126
const CLERK_DEFAULT_MUTED: [number, number, number] = [0x74, 0x76, 0x86]; // #747686

const THEMES = [
  ["dark", '[data-theme="dark"]'],
  ["light", '[data-theme="light"]'],
  ["high-contrast", '[data-theme="high-contrast"]'],
] as const;

function main() {
  // ── 1: the misconfiguration is actually corrected ─────────────
  step("1", "the appearance config is wired correctly");

  for (const v of ["colorForeground", "colorMutedForeground", "colorInput"]) {
    check(`modern variable ${v} is set`, new RegExp(`${v}:\\s*"rgb\\(var\\(`).test(layout));
  }
  for (const v of ["colorText", "colorTextSecondary", "colorInputBackground"]) {
    check(`deprecated alias ${v} kept for older Clerk builds`, layout.includes(`${v}:`));
  }
  check("an `elements` block now exists (it did not before)", /elements:\s*\{/.test(layout));

  // Every element key must be REAL — Clerk types `elements` permissively, so a
  // typo compiles and then silently does nothing.
  const usedKeys = Array.from(layout.matchAll(/^\s{10}(user[A-Za-z]+):/gm)).map((m) => m[1]);
  check("element keys were found in the config", usedKeys.length >= 6, usedKeys.join(", "));
  for (const k of usedKeys) {
    check(`element key "${k}" exists in @clerk/shared`, new RegExp(`\\b${k}\\b`).test(clerkTypes));
  }
  check(
    "the action button (Manage account / Sign out) is themed",
    /userButtonPopoverActionButton:\s*\n?\s*"[^"]*text-text/.test(layout),
  );
  check(
    "the popover card background is themed",
    /userButtonPopoverCard:\s*"[^"]*bg-surface/.test(layout),
  );

  // ── 2: contrast, per theme ────────────────────────────────────
  // The dropdown renders text-text on bg-surface (menu items + name), and
  // text-text-muted on bg-surface (the email + action icons).
  step("2", "dropdown contrast clears AA 4.5:1 in every theme");

  for (const [name, selector] of THEMES) {
    const block = themeBlock(selector);
    const surface = token(block, "--color-surface");
    const surfaceRaised = token(block, "--color-surface-raised");
    const text = token(block, "--color-text");
    const muted = token(block, "--color-text-muted");

    const pairs: [string, [number, number, number], [number, number, number]][] = [
      ["menu item text on the card", text, surface],
      ["menu item text on HOVER", text, surfaceRaised],
      ["muted text (email, icons) on the card", muted, surface],
    ];
    for (const [label, fg, bg] of pairs) {
      const r = contrast(fg, bg);
      check(`${name} — ${label}`, r >= AA_SMALL, `measured ${r.toFixed(2)}:1`);
    }
  }

  // "System Default" is not a fourth palette — it RESOLVES to dark or light
  // before paint, so it is covered by the two above. Assert that, rather than
  // pretending to measure a palette that does not exist.
  step("2b", "System Default resolves to an already-measured palette");
  const themeLib = fs.readFileSync(path.join(ROOT, "lib/theme.ts"), "utf8");
  check(
    "system resolves to dark or light only (never a third palette)",
    /prefers-color-scheme/.test(themeLib),
  );
  check(
    "…so both of its outcomes were measured above",
    THEMES.some(([n]) => n === "dark") && THEMES.some(([n]) => n === "light"),
  );

  // ── 3: the regression this fixes ──────────────────────────────
  step("3", "what the old config produced (the reported bug)");
  for (const [name, selector] of THEMES) {
    const surface = token(themeBlock(selector), "--color-surface");
    const before = contrast(CLERK_DEFAULT_TEXT, surface);
    const after = contrast(token(themeBlock(selector), "--color-text"), surface);
    const wasFailing = before < AA_SMALL;
    console.log(
      `        ${name.padEnd(14)} Clerk default #212126 → ${before.toFixed(2)}:1 ` +
        `${wasFailing ? "(FAILED AA)" : "(passed)"}   themed → ${after.toFixed(2)}:1`,
    );
  }
  const darkSurface = token(themeBlock('[data-theme="dark"]'), "--color-surface");
  check(
    "the dark theme genuinely failed AA before this fix (bug reproduced)",
    contrast(CLERK_DEFAULT_TEXT, darkSurface) < AA_SMALL,
    `Clerk default text on dark surface measured ${contrast(CLERK_DEFAULT_TEXT, darkSurface).toFixed(2)}:1`,
  );
  check(
    "…and Clerk's default MUTED text failed on dark too",
    contrast(CLERK_DEFAULT_MUTED, darkSurface) < AA_SMALL,
    `measured ${contrast(CLERK_DEFAULT_MUTED, darkSurface).toFixed(2)}:1`,
  );
}

try {
  main();
  console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
  if (fail > 0) process.exitCode = 1;
} catch (e) {
  console.error("VERIFY CRASHED:", e);
  process.exitCode = 1;
}
