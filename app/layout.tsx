import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "700"],
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SESS — Simplen Employee Self-Service",
  description:
    "Attendance, quality-linked production appraisals, and precision workforce measurement.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          // Clerk's own widgets read the same theme tokens, so sign-in and the
          // account page re-colour with the rest of the app instead of staying
          // dark on a white page.
          //
          // BOTH the modern and the deprecated names are set on purpose.
          // @clerk/types 4.101 renamed colorText → colorForeground,
          // colorTextSecondary → colorMutedForeground and colorInputBackground
          // → colorInput. Setting only the old names left the new ones unset,
          // so Clerk fell back to its built-in defaults (#212126 text on a
          // white card) — which is what made the UserButton dropdown unreadable
          // on the dark theme. Keeping both keeps older Clerk builds working.
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
          // ─── THE ACTUAL FIX ────────────────────────────────────────────
          // `variables` alone cannot be relied on here: Clerk parses those
          // values to derive hover/alpha shades, and a `rgb(var(--token))`
          // reference is opaque to a colour parser — it resolves only at paint
          // time, in the browser. Anything Clerk derives from it silently falls
          // back to a default.
          //
          // These `elements` entries are plain CSS classes stamped onto the
          // DOM nodes instead, so they resolve through globals.css against
          // whatever [data-theme] is active. That is why this works across all
          // four themes at once with no theme detection and no JS: the same
          // mechanism the rest of the app already uses, and the same pattern as
          // the existing `avatarBox: "h-7 w-7"` in portal-shell.tsx.
          userButtonPopoverCard: "bg-surface border border-border shadow-panel",
          userButtonPopoverMain: "bg-surface",
          // "Manage account" and "Sign out" — the unreadable items.
          // NOTE: the label inherits from the button — there is no separate
          // `...ButtonText` key. Clerk types `elements` as a permissive record,
          // so an invented key type-checks and then silently does nothing;
          // every key here was checked against @clerk/shared's element list.
          userButtonPopoverActionButton:
            "text-text hover:bg-surface-raised hover:text-text",
          userButtonPopoverActionButtonIcon: "text-text-muted",
          // The name/email block above the actions.
          userPreviewMainIdentifier: "text-text",
          userPreviewSecondaryIdentifier: "text-text-muted",
          // Clerk's "Secured by" strip sits on the same card.
          userButtonPopoverFooter: "bg-surface border-t border-border",

          // ─── SIGN-IN / SIGN-UP CARD ────────────────────────────────────
          // The block above was scoped to the UserButton popover only, so the
          // auth card kept Clerk's defaults and hit the same bug: grey-on-dark
          // "Continue with Google", divider and footer text.
          //
          // These live on the PROVIDER rather than on <SignIn>/<SignUp>
          // because the card renders from three places — /sign-in, /sign-up,
          // and <SignInButton mode="modal"> on the landing page. Styling it
          // here covers the modal too, which a per-page appearance prop would
          // have missed entirely.
          card: "bg-surface border border-border shadow-panel",
          headerTitle: "text-text",
          headerSubtitle: "text-text-muted",

          // "Continue with Google" — the reported one. Clerk renders the label
          // in a nested span, so the button alone is not enough; the *Text key
          // is what actually colours the words.
          socialButtonsBlockButton:
            "bg-surface-raised border border-border text-text hover:bg-surface-raised hover:border-accent",
          socialButtonsBlockButtonText: "text-text",

          // The "or" separator between social and email sign-in.
          dividerLine: "bg-border",
          dividerText: "text-text-muted",

          // Email/password fields.
          formFieldLabel: "text-text",
          formFieldInput:
            "bg-surface-raised border border-border text-text placeholder:text-text-muted",
          formFieldInputShowPasswordButton: "text-text-muted hover:text-text",
          formFieldHintText: "text-text-muted",
          formFieldErrorText: "text-danger",
          formButtonPrimary: "bg-accent text-background hover:opacity-90",

          // The verification-code screen and the "signing in as …" line.
          otpCodeFieldInput: "bg-surface-raised border border-border text-text",
          identityPreviewText: "text-text",
          identityPreviewEditButton: "text-accent hover:opacity-80",

          // "Don't have an account? Sign up" and the "Secured by Clerk /
          // Development mode" strip.
          footer: "bg-surface",
          footerActionText: "text-text-muted",
          footerActionLink: "text-accent hover:opacity-80",
          footerPagesLink: "text-text-muted hover:text-text",
        },
      }}
    >
      <html
        lang="en"
        // data-theme is set by the inline script below before first paint;
        // suppressHydrationWarning because the server cannot know it.
        suppressHydrationWarning
        className={`${display.variable} ${body.variable} ${mono.variable}`}
      >
        <head>
          {/* Runs synchronously before paint — without it every navigation
              would flash the default theme before the stored one applied. */}
          <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        </head>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
