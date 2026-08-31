/**
 * A Next.js request context, outside Next.
 *
 * `unstable_cache` and `revalidateTag` are not free functions — both read
 * Next's staticGenerationAsyncStorage and throw ("Invariant: incrementalCache
 * missing") when there is no store. That is why a caching test cannot simply
 * import lib/cache/ and call it.
 *
 * This module supplies the REAL pieces: Next's own IncrementalCache backed by
 * its own FileSystemCache handler, inside Next's own async-local store. It
 * fakes nothing about the cache — the code under test is the same
 * unstable_cache that runs in production, storing to the same .next/cache
 * directory with the same keys and the same tag manifest.
 *
 * ONE thing is emulated rather than borrowed: the end-of-request flush.
 * revalidateTag() only records the tag on the store (see
 * next/dist/server/web/spec-extension/revalidate.js); the App Router's route
 * module then calls incrementalCache.revalidateTag(store.revalidatedTags)
 * when the handler returns (app-route/module.js:266). `request()` below does
 * exactly that, at exactly that moment, which is what makes a call to
 * lib/invalidation/* inside a scope behave as it does inside a real route.
 */
import path from "node:path";
import { IncrementalCache } from "next/dist/server/lib/incremental-cache/index.js";
import { nodeFs } from "next/dist/server/lib/node-fs-methods.js";
import { staticGenerationAsyncStorage } from "next/dist/client/components/static-generation-async-storage.external.js";

const incrementalCache = new IncrementalCache({
  fs: nodeFs,
  dev: false,
  appDir: true,
  pagesDir: false,
  flushToDisk: true,
  fetchCache: true,
  minimalMode: false,
  serverDistDir: path.join(process.cwd(), ".next", "server"),
  requestHeaders: {},
  requestProtocol: "http",
  getPrerenderManifest: () => ({
    version: 4,
    routes: {},
    dynamicRoutes: {},
    notFoundRoutes: [],
    preview: {
      previewModeId: "selfcheck",
      previewModeSigningKey: "selfcheck",
      previewModeEncryptionKey: "selfcheck",
    },
  }),
  allowedRevalidateHeaderKeys: [],
  experimental: { ppr: false },
} as never);

/**
 * Run `fn` as if it were one App Router request, then flush its revalidations.
 *
 * Every read and every invalidation in the self-check goes through here, so a
 * tag dropped in one scope is only visible to the NEXT scope — the same
 * "WRITE → DATABASE → INVALIDATE CACHE → NEXT READ = FRESH DATA" ordering the
 * strategy document specifies, enforced by the harness rather than assumed.
 */
export async function request<T>(fn: () => Promise<T>): Promise<T> {
  const store = {
    isStaticGeneration: false,
    urlPathname: "/",
    pagePath: "/",
    incrementalCache,
    pendingRevalidates: {},
    revalidatedTags: [] as string[],
    isOnDemandRevalidate: false,
    isDraftMode: false,
    forceDynamic: true,
    nextFetchId: 1,
    tags: [] as string[],
  };
  const result = await staticGenerationAsyncStorage.run(store as never, fn);
  await Promise.all(Object.values(store.pendingRevalidates ?? {}));
  if (store.revalidatedTags.length) {
    await incrementalCache.revalidateTag(store.revalidatedTags);
  }
  return result;
}

/** Drop tags without going through a lib/invalidation/* function — used only
 *  to force a cold start, so a previous run's on-disk entries cannot make the
 *  first read of this run look like a hit. */
export async function forceCold(tags: string[]) {
  await incrementalCache.revalidateTag(tags);
}
