import type { Appearance } from "@clerk/types";

/**
 * ONE appearance object for every Clerk component in the app.
 *
 * ─── WHY THIS FILE EXISTS ────────────────────────────────────────────────
 * Clerk ships its own light-mode palette and knows nothing about SESS's theme
 * tokens. Three separate components have now been reported unreadable on the
 * dark theme for the same underlying reason — UserButton's dropdown, the
 * Sign-In/Sign-Up card, and the "Primary" badge on the account page. Each was
 * a different element key, but the same bug.
 *
 * Fixing them one component at a time means the next Clerk surface anyone
 * opens is unreadable again. So the rule here is deliberately inverted: style
 * the SHARED primitives (card, text, badge, button, input, table, navbar,
 * menu, alert) rather than per-component wrappers. A Clerk component this app
 * has never rendered still gets themed, because it is built from these same
 * primitives.
 *
 * ─── WHY CLASSES, NOT `variables` ────────────────────────────────────────
 * `variables` are parsed by Clerk to derive hover/alpha shades, and a
 * `rgb(var(--token))` reference is opaque to a colour parser — it only
 * resolves at paint time in the browser, so anything Clerk derives from it
 * falls back to a default. The `elements` entries below are plain CSS classes
 * stamped onto the DOM, resolved by globals.css against whatever [data-theme]
 * is live. That is why one object covers all themes with no theme detection
 * and no JS.
 *
 * `variables` are still set as a backstop for any surface without an element
 * key, and both the modern and deprecated colour names are provided:
 * @clerk/types 4.101 renamed colorText → colorForeground, colorTextSecondary
 * → colorMutedForeground and colorInputBackground → colorInput.
 *
 * ─── EVERY KEY HERE IS REAL ──────────────────────────────────────────────
 * Clerk types `elements` as a permissive record, so an invented key compiles
 * and then silently does nothing. Two such typos have already been caught this
 * way (`userButtonPopoverActionButtonText`, `socialButtonsBlockButtonArrow`).
 * prisma/verify-clerk-appearance.ts validates every key in this file against
 * @clerk/shared's element list — do not add one without it passing.
 */
export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: "rgb(var(--color-accent))",
    colorBackground: "rgb(var(--color-surface))",
    colorForeground: "rgb(var(--color-text))",
    colorMutedForeground: "rgb(var(--color-text-muted))",
    colorInput: "rgb(var(--color-surface-raised))",
    colorInputBackground: "rgb(var(--color-surface-raised))",
    colorText: "rgb(var(--color-text))",
    colorTextSecondary: "rgb(var(--color-text-muted))",
    borderRadius: "4px",
  },
  elements: {
    // ── SHARED PRIMITIVES ────────────────────────────────────────────────
    // Everything below this line is what makes a not-yet-built Clerk surface
    // come out themed without a new patch.
    card: "bg-surface border border-border shadow-panel",
    cardBox: "bg-surface",
    headerTitle: "text-text",
    headerSubtitle: "text-text-muted",
    footer: "bg-surface",
    footerActionText: "text-text-muted",
    footerActionLink: "text-accent hover:opacity-80",
    footerPagesLink: "text-text-muted hover:text-text",

    // THE REPORTED BUG. `badge` is the generic tag primitive — the "Primary"
    // chip beside an email on the account page is one, and so is every future
    // status chip. Clerk's default is near-black on a pale chip, invisible on
    // the dark theme. Both foreground AND background are set so it reads on
    // every theme rather than only inheriting text colour.
    badge: "bg-surface-raised text-text border border-border",

    // Generic buttons and the "reset"/secondary variants.
    formButtonPrimary: "bg-accent text-background hover:opacity-90",
    formButtonReset: "text-text-muted hover:text-text",
    button: "text-text",
    buttonArrowIcon: "text-text-muted",
    selectButton: "bg-surface-raised border border-border text-text",
    selectButtonIcon: "text-text-muted",
    actionCard: "bg-surface border border-border",

    // Form fields.
    formFieldLabel: "text-text",
    formFieldInput:
      "bg-surface-raised border border-border text-text placeholder:text-text-muted",
    formFieldInputShowPasswordButton: "text-text-muted hover:text-text",
    formFieldHintText: "text-text-muted",
    formFieldErrorText: "text-danger",
    formFieldAction: "text-accent hover:opacity-80",
    otpCodeFieldInput: "bg-surface-raised border border-border text-text",

    // Alerts / inline messages.
    alert: "bg-surface-raised border border-border",
    alertText: "text-text",
    alertIcon: "text-text-muted",

    // Modals (Clerk portals these to <body>, outside the app's own DOM).
    modalContent: "bg-surface",
    modalCloseButton: "text-text-muted hover:text-text",

    // ── SIGN-IN / SIGN-UP ────────────────────────────────────────────────
    // Clerk renders the social label in a nested span, so the button alone is
    // not enough — the *Text key is what colours the words.
    socialButtonsBlockButton:
      "bg-surface-raised border border-border text-text hover:bg-surface-raised hover:border-accent",
    socialButtonsBlockButtonText: "text-text",
    dividerLine: "bg-border",
    dividerText: "text-text-muted",
    identityPreviewText: "text-text",
    identityPreviewEditButton: "text-accent hover:opacity-80",

    // ── USER PROFILE / ACCOUNT PAGE (Profile + Security tabs) ────────────
    navbar: "bg-surface border-r border-border",
    navbarButton: "text-text-muted hover:text-text",
    navbarButtonText: "text-text",
    navbarButtonIcon: "text-text-muted",
    navbarMobileMenuButton: "text-text",
    navbarMobileMenuButtonIcon: "text-text-muted",
    pageScrollBox: "bg-surface",
    scrollBox: "bg-surface",
    profileSection: "border-b border-border",
    profileSectionTitleText: "text-text",
    profileSectionSubtitleText: "text-text-muted",
    profileSectionPrimaryButton: "text-accent hover:opacity-80",
    profileSectionContent: "text-text",
    // Rows in Security: passkeys, active devices, MFA methods.
    table: "text-text",
    tableHeaderCell: "text-text-muted",
    tableBodyCell: "text-text",
    // The row "…" overflow menu.
    menuList: "bg-surface border border-border shadow-panel",
    menuItem: "text-text hover:bg-surface-raised",
    menuButton: "text-text",
    menuButtonEllipsis: "text-text-muted hover:text-text",

    // ── USER BUTTON DROPDOWN ─────────────────────────────────────────────
    // NOTE: the action label inherits from the button — there is no separate
    // `...ButtonText` key.
    userButtonPopoverCard: "bg-surface border border-border shadow-panel",
    userButtonPopoverMain: "bg-surface",
    userButtonPopoverActionButton: "text-text hover:bg-surface-raised hover:text-text",
    userButtonPopoverActionButtonIcon: "text-text-muted",
    userButtonPopoverFooter: "bg-surface border-t border-border",
    userPreviewMainIdentifier: "text-text",
    userPreviewSecondaryIdentifier: "text-text-muted",
  },
};
