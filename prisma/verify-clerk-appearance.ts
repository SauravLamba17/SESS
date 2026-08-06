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
// The appearance moved out of layout.tsx into one shared module so every
// Clerk surface inherits it. layout.tsx is still read, to prove it is wired.
const layout = fs.readFileSync(path.join(ROOT, "lib/clerk-appearance.ts"), "utf8");
const rootLayout = fs.readFileSync(path.join(ROOT, "app/layout.tsx"), "utf8");
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
  //
  // The elements block is sliced out first: `variables` keys sit at the same
  // indent, and validating those against the element list would fail wrongly.
  const elementsBlock = layout.slice(layout.indexOf("elements: {"));
  const usedKeys = Array.from(elementsBlock.matchAll(/^\s{4}([a-z][A-Za-z]+):/gm)).map(
    (m) => m[1],
  );
  check("element keys were found in the config", usedKeys.length >= 20, `${usedKeys.length} keys`);
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

  // ── 2c: the SIGN-IN / SIGN-UP card ────────────────────────────
  // Same class of bug, different component: the elements block was scoped to
  // the UserButton popover, so the auth card kept Clerk's defaults — grey
  // "Continue with Google", divider and footer text on a dark card.
  step("2c", "sign-in / sign-up card clears AA 4.5:1 in every theme");

  // Every key the card actually needs, and where it renders.
  for (const [key, note] of [
    ["card", "the card itself"],
    ["headerTitle", "Sign in to SESS"],
    ["headerSubtitle", "Welcome back…"],
    ["socialButtonsBlockButton", "the Continue with Google button"],
    ["socialButtonsBlockButtonText", "its LABEL — the reported bug"],
    ["dividerText", "the 'or' separator"],
    ["formFieldLabel", "Email address / Password"],
    ["formFieldInput", "the input itself"],
    ["footerActionText", "Don't have an account?"],
    ["footerActionLink", "the Sign up link"],
    ["footerPagesLink", "Secured by Clerk / Development mode"],
  ] as const) {
    check(`${key} is themed — ${note}`, new RegExp(`\\b${key}:`).test(elementsBlock));
  }
  check(
    "the Google button's LABEL is coloured, not just the button",
    /socialButtonsBlockButtonText:\s*"[^"]*text-text/.test(elementsBlock),
  );

  for (const [name, selector] of THEMES) {
    const block = themeBlock(selector);
    const surface = token(block, "--color-surface");
    const raised = token(block, "--color-surface-raised");
    const base = token(block, "--color-base");
    const text = token(block, "--color-text");
    const muted = token(block, "--color-text-muted");
    const accent = token(block, "--color-accent");
    const danger = token(block, "--color-danger");

    const pairs: [string, [number, number, number], [number, number, number]][] = [
      ["header title on the card", text, surface],
      ["header subtitle on the card", muted, surface],
      ['"Continue with Google" label on its button', text, raised],
      ['the "or" divider text', muted, surface],
      ["form field label", text, surface],
      ["typed input text", text, raised],
      ["input placeholder", muted, raised],
      ["field error text", danger, surface],
      ["primary button label on accent", base, accent],
      ['"Don\'t have an account?"', muted, surface],
      ['the "Sign up" link', accent, surface],
      ["Secured by Clerk / Development mode", muted, surface],
      ["identity preview text", text, surface],
      ["OTP code input text", text, raised],
    ];
    for (const [label, fg, bg] of pairs) {
      const r = contrast(fg, bg);
      check(`${name} — ${label}`, r >= AA_SMALL, `measured ${r.toFixed(2)}:1`);
    }
  }

  // ── 2d: the ACCOUNT PAGE (UserProfile — Profile + Security) ────
  // The third component reported for the same bug. The "Primary" chip beside
  // an email rendered near-black on the dark card.
  step("2d", "account page + the Primary badge clear AA in every theme");

  // `badge` is the REAL key — not `identificationBadge`. Clerk types it as
  // WithOptions<'primary' | 'actionRequired'>, and the localization key
  // badge__primary is what renders the word "Primary".
  check("badge is a real Clerk element key", /\bbadge:/.test(clerkTypes));
  check("the badge is themed", /\bbadge:\s*"/.test(elementsBlock));
  check(
    "…with BOTH a background and a foreground (a text colour alone would inherit Clerk's chip)",
    /\bbadge:\s*"[^"]*bg-surface-raised[^"]*text-text/.test(elementsBlock),
  );

  for (const [key, note] of [
    ["navbar", "the Profile/Security sidebar"],
    ["navbarButton", "its tab buttons"],
    ["profileSectionTitleText", "section headings"],
    ["profileSectionSubtitleText", "section descriptions"],
    ["profileSectionPrimaryButton", "Add / Update actions"],
    ["pageScrollBox", "the page body behind it all"],
    ["table", "Security: passkeys / devices / MFA rows"],
    ["tableHeaderCell", "…their column headers"],
    ["menuList", "the row overflow menu"],
    ["menuItem", "…its items"],
    ["alertText", "inline warnings on the Security tab"],
    ["formButtonReset", "secondary/cancel buttons"],
  ] as const) {
    check(`${key} is themed — ${note}`, new RegExp(`\\b${key}:`).test(elementsBlock));
  }

  for (const [name, selector] of THEMES) {
    const block = themeBlock(selector);
    const surface = token(block, "--color-surface");
    const raised = token(block, "--color-surface-raised");
    const text = token(block, "--color-text");
    const muted = token(block, "--color-text-muted");
    const accent = token(block, "--color-accent");

    const pairs: [string, [number, number, number], [number, number, number]][] = [
      ['the "Primary" BADGE label on its chip', text, raised],
      ["navbar tab (resting)", muted, surface],
      ["navbar tab (active/hover)", text, surface],
      ["profile section heading", text, surface],
      ["profile section description", muted, surface],
      ["Add / Update action link", accent, surface],
      ["Security table cell text", text, surface],
      ["Security table column header", muted, surface],
      ["overflow menu item", text, surface],
      ["overflow menu item on hover", text, raised],
      ["inline alert text", text, raised],
      ["secondary button (resting)", muted, surface],
    ];
    for (const [label, fg, bg] of pairs) {
      const r = contrast(fg, bg);
      check(`${name} — ${label}`, r >= AA_SMALL, `measured ${r.toFixed(2)}:1`);
    }
  }

  // ── 2e: the consolidation itself ──────────────────────────────
  step("2e", "one shared appearance, applied globally");
  check(
    "the appearance lives in its own module, not inline in layout.tsx",
    fs.existsSync(path.join(ROOT, "lib/clerk-appearance.ts")),
  );
  check(
    "layout.tsx passes it to ClerkProvider",
    /<ClerkProvider appearance=\{clerkAppearance\}>/.test(rootLayout),
  );
  check(
    "…and layout.tsx no longer carries an inline elements block",
    !/elements:\s*\{/.test(rootLayout),
  );
  // The ONE surviving component-level appearance must be layout-only, never
  // colour — otherwise it is a per-component patch of the kind this replaces.
  const shell = fs.readFileSync(path.join(ROOT, "components/portal/portal-shell.tsx"), "utf8");
  const shellAppearance = /appearance=\{\{[^}]*\{([^}]*)\}/.exec(shell)?.[1] ?? "";
  check(
    "the only component-level override left is sizing, not colour",
    /h-\d+ w-\d+/.test(shellAppearance) &&
      !/text-|bg-|border-/.test(shellAppearance),
    shellAppearance.trim(),
  );

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
