import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

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
    "Camera-verified attendance, quality-linked production appraisals, and precision workforce measurement.",
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
          colorPrimary: "#F5A623",
          colorBackground: "#171D21",
          colorInputBackground: "#1E262B",
          colorText: "#E8ECEE",
          colorTextSecondary: "#8B98A1",
          borderRadius: "4px",
        },
      }}
    >
      <html
        lang="en"
        className={`${display.variable} ${body.variable} ${mono.variable}`}
      >
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
