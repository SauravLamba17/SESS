"use client";

/**
 * The one job of this file: hold the `next/dynamic(..., { ssr: false })` call.
 *
 * Next 14 rejects `ssr: false` inside a Server Component, and app/page.tsx has
 * to stay a Server Component so it can run the signed-in redirect. So the
 * boundary is here, in the smallest possible client file — the cinematic page
 * (and, through it, three and lenis) never reaches any other route's bundle,
 * and no server render ever touches window/document/WebGL.
 */

import dynamic from "next/dynamic";

const CinematicLanding = dynamic(() => import("./cinematic-landing"), {
  ssr: false,
  // Matches the page's own void background, so there is no white flash while
  // the chunk downloads.
  loading: () => (
    <div
      style={{ position: "fixed", inset: 0, background: "#05070A" }}
      aria-hidden="true"
    />
  ),
});

export default CinematicLanding;
