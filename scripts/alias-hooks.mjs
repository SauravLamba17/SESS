import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

const ROOT = process.cwd().split("\\").join("/");

/**
 * Two resolution rules plain `node` does not have but the app relies on:
 *
 *  1. the tsconfig "@/..." path alias, so lib/cache/* and lib/invalidation/*
 *     can be imported unmodified — a test that imports a rewritten copy of the
 *     module under test proves nothing about the module that ships;
 *  2. extensionless package subpaths ("next/cache"), which Next's own
 *     bundler resolves and Node's ESM resolver does not.
 */
export async function resolve(specifier, context, next) {
  // `server-only` is a build-time marker: it throws unless resolved under the
  // "react-server" condition, and turning that condition on globally makes
  // React 18 resolve to an experimental entry point that throws instead. The
  // module has no runtime behaviour, so it is stubbed here rather than fought.
  if (specifier === "server-only") {
    return next(pathToFileURL(`${ROOT}/scripts/empty.mjs`).href, context);
  }
  if (specifier.startsWith("@/")) {
    const base = `${ROOT}/${specifier.slice(2)}`;
    for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
      if (existsSync(base + ext)) {
        return next(pathToFileURL(base + ext).href, context);
      }
    }
  }
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND" && err?.code !== "ERR_UNSUPPORTED_DIR_IMPORT") {
      throw err;
    }
    for (const ext of [".js", "/index.js"]) {
      try {
        return await next(specifier + ext, context);
      } catch {
        /* try the next candidate */
      }
    }
    throw err;
  }
}
