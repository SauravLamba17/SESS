import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { clerkAppearance } from "@/lib/clerk-appearance";

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
  // `template` lets each route set only its own name — the tab then reads
  // "My Dashboard · SESS" instead of the same string on every page.
  title: {
    default: "SESS — Simplen Employee Self-Service",
    template: "%s · SESS",
  },
  description:
    "Attendance, quality-linked production appraisals, and precision workforce measurement.",
};

/**
 * Matches the browser chrome to the page background per theme. The values are
 * --color-base from app/globals.css: #0F1417 (dark) and #FFFFFF (light).
 * "high-contrast" is a manual [data-theme] choice with no media query to key
 * off, so it falls back to the dark entry — the closer of the two.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0F1417" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider appearance={clerkAppearance}>
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
