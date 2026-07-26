/**
 * Phase 14 verification — appraisal /5 display transform + theme resolution.
 *
 * Both subjects are pure, so this needs no database and no server.
 *
 * The most important assertion here is the LAST one: that lib/appraisal/
 * compute.ts is byte-for-byte what it was before this phase. The whole premise
 * of the /5 change is that it is a display layer over an untouched engine, and
 * that claim is worth machine-checking rather than asserting.
 *
 * Run:  node prisma/verify-phase14.ts
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  formatScoreOutOfFive,
  formatComponentOutOf5,
  formatBandLabelOutOfFive,
  scoreOutOfFive,
  SCALE_DIVISOR,
  NOT_APPRAISED,
  NO_DATA,
} from "../lib/appraisal/display.ts";
import { resolveTheme, isThemeMode, THEME_MODES, THEME_INIT_SCRIPT } from "../lib/theme.ts";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
}
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, a === e ? "" : `expected ${e}, got ${a}`);
}
function step(n: string, title: string) {
  console.log(`\n── ${n}: ${title} ${"─".repeat(Math.max(0, 44 - title.length))}`);
}

// ── 1: the transform ────────────────────────────────────────────
step("1", "formatScoreOutOfFive");
eq("divisor is 20", SCALE_DIVISOR, 20);
// The example from the brief.
eq("79 → 4.0/5", formatScoreOutOfFive(79), "4.0/5");
eq("100 → 5.0/5", formatScoreOutOfFive(100), "5.0/5");
eq("0 → 0.0/5", formatScoreOutOfFive(0), "0.0/5");
eq("50 → 2.5/5", formatScoreOutOfFive(50), "2.5/5");
eq("82.5 → 4.1/5", formatScoreOutOfFive(82.5), "4.1/5");
eq("66 → 3.3/5", formatScoreOutOfFive(66), "3.3/5");
eq("null → empty state", formatScoreOutOfFive(null), NOT_APPRAISED);
eq("undefined → empty state", formatScoreOutOfFive(undefined), NOT_APPRAISED);
eq("NaN → empty state, never 'NaN/5'", formatScoreOutOfFive(Number.NaN), NOT_APPRAISED);
eq("Infinity → empty state", formatScoreOutOfFive(Number.POSITIVE_INFINITY), NOT_APPRAISED);
check("always one decimal place", /^\d+\.\d\/5$/.test(formatScoreOutOfFive(100)));

step("1b", "scoreOutOfFive — bare number for stat cards");
eq("79 → 4.0", scoreOutOfFive(79), "4.0");
eq("null → null (caller renders its own dash)", scoreOutOfFive(null), null);

step("1c", "formatComponentOutOf5");
eq("component 90 → 4.5/5", formatComponentOutOf5(90), "4.5/5");
eq("component 0 → 0.0/5", formatComponentOutOf5(0), "0.0/5");
eq("component null → no data", formatComponentOutOf5(null), NO_DATA);

step("1d", "band labels track the real 0-100 thresholds");
eq("0–40 → 0.0–2.0", formatBandLabelOutOfFive(0, 40), "0.0–2.0");
eq("40–60 → 2.0–3.0", formatBandLabelOutOfFive(40, 60), "2.0–3.0");
eq("60–80 → 3.0–4.0", formatBandLabelOutOfFive(60, 80), "3.0–4.0");
eq("80–100 → 4.0–5.0", formatBandLabelOutOfFive(80, 100), "4.0–5.0");

step("1e", "the transform is DISPLAY ONLY — it never changes ordering");
// If the /5 form ever disagreed with the raw form about which score is higher,
// a threshold read off the display would silently diverge from the engine.
const raws = [0, 12.5, 39.9, 40, 59.99, 60, 79, 80, 99.5, 100];
let monotonic = true;
for (let i = 1; i < raws.length; i++) {
  const prev = Number(scoreOutOfFive(raws[i - 1]));
  const cur = Number(scoreOutOfFive(raws[i]));
  if (cur < prev) monotonic = false;
}
check("display order matches raw order across the whole range", monotonic);
check(
  "a 0-100 value round-trips to the same raw magnitude",
  Math.abs(Number(scoreOutOfFive(79)) * SCALE_DIVISOR - 80) < 1.01,
  "4.0 × 20 = 80, within display rounding of 79",
);

// ── 2: theme resolution ─────────────────────────────────────────
step("2", "theme mode resolution");
eq("four modes offered", THEME_MODES.length, 4);
eq(
  "modes are dark/light/high-contrast/system",
  THEME_MODES.map((t) => t.mode),
  ["dark", "light", "high-contrast", "system"],
);
eq("explicit dark stays dark", resolveTheme("dark", true), "dark");
eq("explicit light stays light even if OS is dark", resolveTheme("light", true), "light");
eq("explicit high-contrast is never overridden", resolveTheme("high-contrast", true), "high-contrast");
eq("system + OS dark → dark", resolveTheme("system", true), "dark");
eq("system + OS light → light", resolveTheme("system", false), "light");
check(
  "system NEVER resolves to high-contrast (no OS signal maps to it)",
  resolveTheme("system", true) !== "high-contrast" &&
    resolveTheme("system", false) !== "high-contrast",
);

step("2b", "stored-value validation");
check("valid modes accepted", ["dark", "light", "high-contrast", "system"].every(isThemeMode));
check("garbage rejected", !isThemeMode("neon") && !isThemeMode(null) && !isThemeMode(42));

step("2c", "the pre-paint script");
check("sets data-theme", THEME_INIT_SCRIPT.includes("setAttribute('data-theme'"));
check("reads the storage key", THEME_INIT_SCRIPT.includes("sess-theme"));
check("resolves system via prefers-color-scheme", THEME_INIT_SCRIPT.includes("prefers-color-scheme"));
check(
  "cannot throw during head execution (falls back to dark)",
  THEME_INIT_SCRIPT.includes("catch") && THEME_INIT_SCRIPT.includes("'dark'"),
);

// ── 2d: WCAG CONTRAST, measured from the shipped tokens ─────────
//
// The three values fixed here were previously measured once, by hand, in a
// browser. That proved nothing about tomorrow. These assertions parse the REAL
// token values out of app/globals.css and apply the WCAG 2.x relative-luminance
// formula, so a future palette edit that drops a colour back under AA fails the
// suite instead of shipping.
step("2d", "WCAG AA contrast of the theme tokens");

const cssPath = path.resolve(import.meta.dirname, "..", "app", "globals.css");
const css = fs.readFileSync(cssPath, "utf8");

/** Pull one theme's block out of globals.css. */
function themeBlock(selector: string): string {
  const i = css.indexOf(selector);
  if (i === -1) throw new Error(`theme block not found: ${selector}`);
  const open = css.indexOf("{", i);
  const close = css.indexOf("}", open);
  return css.slice(open, close);
}

/** Read a token's "R G B" channels from a theme block. */
function token(block: string, name: string): [number, number, number] {
  const m = new RegExp(`${name}:\\s*([0-9]+)\\s+([0-9]+)\\s+([0-9]+)\\s*;`).exec(block);
  if (!m) throw new Error(`token not found: ${name}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** WCAG 2.x relative luminance. */
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
const darkBlock = themeBlock('[data-theme="dark"]');
const lightBlock = themeBlock('[data-theme="light"]');
const hcBlock = themeBlock('[data-theme="high-contrast"]');

function assertAA(label: string, fg: [number, number, number], bg: [number, number, number]) {
  const r = contrast(fg, bg);
  check(`${label} clears AA 4.5:1`, r >= AA_SMALL, `measured ${r.toFixed(2)}:1`);
}

// The three values this pass corrected.
assertAA(
  "light textMuted on surface",
  token(lightBlock, "--color-text-muted"),
  token(lightBlock, "--color-surface"),
);
assertAA(
  "light accent on surface",
  token(lightBlock, "--color-accent"),
  token(lightBlock, "--color-surface"),
);
assertAA(
  "dark danger on surface",
  token(darkBlock, "--color-danger"),
  token(darkBlock, "--color-surface"),
);

// Guard the rest of the palette so a future edit cannot regress it either.
for (const [name, block] of [
  ["dark", darkBlock],
  ["light", lightBlock],
  ["high-contrast", hcBlock],
] as const) {
  const surface = token(block, "--color-surface");
  const base = token(block, "--color-base");
  assertAA(`${name} text on surface`, token(block, "--color-text"), surface);
  assertAA(`${name} good on surface`, token(block, "--color-good"), surface);
  assertAA(`${name} info on surface`, token(block, "--color-info"), surface);
  // The primary button pattern used across the app: bg-accent + text-background.
  assertAA(`${name} accent fill vs base text`, token(block, "--color-accent"), base);
  assertAA(`${name} danger fill vs base text`, token(block, "--color-danger"), base);
}

// The three untouched values, pinned so an accidental edit is caught.
eq("dark accent unchanged", token(darkBlock, "--color-accent"), [245, 166, 35]);
eq("light good unchanged", token(lightBlock, "--color-good"), [26, 127, 75]);
eq("high-contrast palette unchanged", token(hcBlock, "--color-danger"), [255, 107, 107]);

// ── 3: THE ENGINE IS UNTOUCHED ──────────────────────────────────
step("3", "lib/appraisal/compute.ts is unchanged");
const computePath = path.resolve(import.meta.dirname, "..", "lib", "appraisal", "compute.ts");
const src = fs.readFileSync(computePath);
// Git blob hash recorded BEFORE any Phase 14 edit was made.
const EXPECTED_BLOB = "41c4a88bbcfb280f42a9d0f55fa168fedcaf0da7";
const blob = crypto
  .createHash("sha1")
  .update(Buffer.concat([Buffer.from(`blob ${src.length}\0`), src]))
  .digest("hex");
eq("git blob hash matches the pre-phase baseline", blob, EXPECTED_BLOB);
check(
  "compute.ts contains no reference to the display layer",
  !src.toString().includes("display") && !src.toString().includes("OutOfFive"),
);
check(
  "compute.ts still clamps to 0-100, not 0-5",
  src.toString().includes("clamp(") && src.toString().includes("100"),
);

console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
if (fail > 0) process.exitCode = 1;
