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
};

export default nextConfig;
