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
          colorPrimary: "rgb(var(--color-accent))",
          colorBackground: "rgb(var(--color-surface))",
          colorInputBackground: "rgb(var(--color-surface-raised))",
          colorText: "rgb(var(--color-text))",
          colorTextSecondary: "rgb(var(--color-text-muted))",
          borderRadius: "4px",
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
