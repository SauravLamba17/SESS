/**
 * Clerk's Frontend API host, read from the publishable key itself
 * (pk_<env>_<base64("host$")>) so the policy follows the key if the Clerk
 * instance ever changes — today a dev instance on *.clerk.accounts.dev.
 */
const clerkHost = (() => {
  try {
    const b64 = (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "").split("_")[2] ?? "";
    const host = Buffer.from(b64, "base64").toString().replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : "https://*.clerk.accounts.dev";
  } catch {
    return "https://*.clerk.accounts.dev";
  }
})();

/**
 * REPORT-ONLY ON PURPOSE. This header never blocks anything — the browser only
 * logs "[Report Only] Refused to …" to the console. Watch the console on every
 * portal (sign-in, sign-up, landing, PDF download, each role's pages) for a
 * full working cycle BEFORE renaming this to Content-Security-Policy; one
 * missing source in enforcing mode silently breaks sign-in.
 *
 * Every source and why:
 *  default-src 'self'           — everything not listed below is same-origin only.
 *  script-src 'unsafe-inline'   — Next 14 App Router streams RSC payload in inline
 *                                 <script> tags, and THEME_INIT_SCRIPT in
 *                                 app/layout.tsx must run inline before first paint.
 *                                 No nonce plumbing exists yet; that is the upgrade
 *                                 path before enforcing. No 'unsafe-eval': only dev
 *                                 (React Refresh) needs it, and dev is not shipped.
 *  script-src clerkHost         — clerk-js is loaded from Clerk's Frontend API.
 *  challenges.cloudflare.com    — Clerk's bot protection (Turnstile) on sign-up:
 *                                 script + iframe.
 *  style-src 'unsafe-inline'    — Clerk components and Next/React inline styles.
 *  img-src img.clerk.com        — Clerk avatars/logos; data: for inline SVG icons;
 *                                 blob: for avatar previews in <UserProfile>.
 *  font-src 'self' data:        — Space Grotesk/Inter/IBM Plex Mono come from
 *                                 next/font/google, which SELF-HOSTS them under
 *                                 /_next/static/media at build time, so
 *                                 fonts.googleapis.com/gstatic are NOT needed.
 *  connect-src clerkHost        — Clerk session/token API calls.
 *  connect-src clerk-telemetry  — Clerk dev instances post SDK telemetry.
 *  worker-src 'self' blob:      — Clerk spins up a blob: worker for token refresh.
 *  three.js / lenis             — bundled npm chunks served from /_next: 'self'.
 *  Vercel Analytics             — not installed, so nothing allowed for it.
 *  object-src 'none', base-uri 'self', frame-ancestors 'none' (mirrors
 *  X-Frame-Options DENY), form-action 'self'.
 */
const cspReportOnly = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${clerkHost} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://img.clerk.com",
  "font-src 'self' data:",
  `connect-src 'self' ${clerkHost} https://clerk-telemetry.com`,
  "frame-src 'self' https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

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
   * Content-Security-Policy ships as REPORT-ONLY (see cspReportOnly above).
   * It is the one header here that can silently break the app, so it observes
   * first and never enforces until its console reports have been watched.
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

          // Observe-only. NEVER rename to Content-Security-Policy without first
          // watching the browser console for violations — see cspReportOnly.
          { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
        ],
      },
      {
        // Every API response is per-user or per-request. `dynamic =
        // "force-dynamic"` stops prerendering but emits NO Cache-Control on a
        // route handler (measured on a production build — see
        // app/api/health/route.ts), so JSON GETs like /api/attendance/month and
        // /api/search went out with none and an intermediary could
        // heuristically cache employee data. Pages need nothing here: Next
        // already sends `private, no-cache, no-store` on every dynamic render.
        // Routes that ALSO set Cache-Control by hand (health, the PDF routes)
        // send both lines; every value involved is no-store, so whichever a
        // cache reads, or the comma-joined union, means the same thing.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
