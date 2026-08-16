/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // @react-pdf/renderer resolves its own font/stream internals at runtime and
    // breaks if the server bundler traces into it. Keep it external.
    serverComponentsExternalPackages: ["@react-pdf/renderer"],
    // REQUIRED on Next 14 for instrumentation.ts to be picked up at all —
    // without it the file is silently ignored and the server would run in
    // Vercel's UTC. (The flag was removed in Next 15, which auto-detects the
    // file; drop this line, not instrumentation.ts, on that upgrade.)
    instrumentationHook: true,
  },

  /**
   * Baseline security headers, applied to every response.
   *
   * The app previously sent NONE of these — confirmed against a live response
   * during the security audit, which is what prompted this.
   *
   * Content-Security-Policy is DELIBERATELY ABSENT. It is the one header here
   * that can silently break the app: the theme script in app/layout.tsx is
   * inline (it must run before first paint) and Clerk loads from its own
   * domains, so a policy has to carry a nonce or hash and an accurate
   * allow-list. That belongs in its own change, rolled out via
   * Content-Security-Policy-Report-Only first. The four below cannot break a
   * working page, which is exactly why they ship separately and first.
   */
  async headers() {
    return [
      {
        // Every path, including /api and /_next static assets.
        source: "/:path*",
        headers: [
          // Clickjacking. The highest-value header here: nothing in this app
          // frames itself, and without this a Super Admin could be tricked
          // into a one-click payroll finalize or offer approval inside a
          // hostile frame. DENY rather than SAMEORIGIN because there is no
          // legitimate framing at all — payslip PDFs are served as
          // Content-Disposition: attachment, never embedded.
          // NOTE: this governs who may frame US. It does not affect Clerk's
          // own iframes, which are same-origin to Clerk, not to this app.
          { key: "X-Frame-Options", value: "DENY" },

          // Stop MIME sniffing. Directly relevant here: resumes and payslips
          // are user-supplied/generated files served through role-checked
          // routes, and a sniffed content type is how a "PDF" gets executed
          // as something else.
          { key: "X-Content-Type-Options", value: "nosniff" },

          // Send the origin but not the path to other sites. Paths in this app
          // carry record ids (/api/payslip/<id>, /hr/candidates/<id>), and the
          // attendance pages now link out to Google Maps — without this, that
          // outbound click would leak the full internal URL as a referrer.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

          // Geolocation is scoped to this origin, not blocked: the web
          // clock-in widget calls navigator.geolocation and must keep working.
          // `self` permits it for our own pages while denying it to any
          // embedded third-party context.
          { key: "Permissions-Policy", value: "geolocation=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
