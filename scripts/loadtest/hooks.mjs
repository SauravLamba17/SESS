// Load-test module hooks — used ONLY by scripts/loadtest/harness.ts.
// They change what the harness process loads, never the app:
//   "@/lib/db"      → ./db-proxy.ts   (one Prisma client per simulated Vercel instance)
//   "next/cache"    → ./next-cache-stub.ts (no Data Cache: every read is a miss — worst case)
//   "server-only"   → empty module
//   "@/..."         → tsconfig path alias
//   *.ts / *.tsx    → transpiled with the project's own TypeScript (JSX for lib/reports)
// Nothing about authentication is touched: no harness path imports lib/auth.
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd().split("\\").join("/");
const HERE = path.dirname(fileURLToPath(import.meta.url)).split("\\").join("/");
const SUBST = {
  "@/lib/db": `${HERE}/db-proxy.ts`,
  "next/cache": `${HERE}/next-cache-stub.ts`,
  "server-only": `${ROOT}/scripts/empty.mjs`,
};

export async function resolve(specifier, context, next) {
  if (SUBST[specifier]) return { url: pathToFileURL(SUBST[specifier]).href, shortCircuit: true };
  if (specifier === "@/lib/auth") throw new Error("load-test harness must not import lib/auth");
  if (specifier.startsWith("@/")) {
    const base = `${ROOT}/${specifier.slice(2)}`;
    for (const ext of ["", ".ts", ".tsx", "/index.ts"])
      if (existsSync(base + ext) && !base.endsWith("/") && (ext || /\.[cm]?[jt]sx?$/.test(base)))
        return { url: pathToFileURL(base + ext).href, shortCircuit: true };
  }
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND" && err?.code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw err;
    for (const ext of [".ts", ".tsx", ".js", "/index.ts", "/index.js"]) {
      try { return await next(specifier + ext, context); } catch { /* next candidate */ }
    }
    throw err;
  }
}

export async function load(url, context, next) {
  if (/\.(ts|tsx)$/.test(url) && url.startsWith("file:") && !url.includes("/node_modules/")) {
    const src = readFileSync(fileURLToPath(url), "utf8");
    const out = ts.transpileModule(src, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        verbatimModuleSyntax: false,
        rewriteRelativeImportExtensions: false,
      },
    });
    return { format: "module", source: out.outputText, shortCircuit: true };
  }
  return next(url, context);
}
