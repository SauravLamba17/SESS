/**
 * Build the SESS Idle Agent installer, then Authenticode-sign it.
 *
 * TWO STEPS, deliberately:
 *   1. electron-builder produces the installer with its own signing DISABLED.
 *   2. tools/sign.ps1 signs it with Windows' Set-AuthenticodeSignature.
 *
 * electron-builder's built-in signing pulls a "winCodeSign" toolchain whose
 * archive contains macOS symlinks; extracting it on Windows fails with
 * "Cannot create symbolic link: A required privilege is not held by the client"
 * unless the build is elevated or Developer Mode is on. Signing separately with
 * a tool that ships with Windows removes that dependency entirely, needs no
 * SDK and no elevation.
 *
 * Signing is SKIPPED (with a clear notice) when no certificate is present, so
 * the project still builds for anyone who has not run make-cert - the private
 * key is deliberately not in the repository.
 *
 *   npm run dist
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CERT_DIR = path.join(ROOT, "certs");
const PFX = path.join(CERT_DIR, "sess-agent-signing.pfx");
const PWD_FILE = path.join(CERT_DIR, "cert-password.txt");
const OUT_DIR = path.join(ROOT, "dist");

const canSign = fs.existsSync(PFX) && fs.existsSync(PWD_FILE);

// ── 1. Package, unsigned ───────────────────────────────────────────
const builderBin = path.join(ROOT, "node_modules", "electron-builder", "cli.js");
if (!fs.existsSync(builderBin)) {
  console.error("electron-builder is not installed. Run `npm install` in agent/ first.");
  process.exit(1);
}

console.log("Packaging (electron-builder, signing disabled)...");
try {
  execFileSync(process.execPath, [builderBin, "--win", "--publish", "never"], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      // Without this, electron-builder hunts for a certificate in the machine
      // store and drags in the winCodeSign toolchain we are avoiding.
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
    },
  });
} catch {
  console.error("\nPackaging failed - see the electron-builder output above.");
  process.exit(1);
}

// "exited 0" is not the same as "an installer exists", and the difference
// matters for a rollout, so the artefact is checked for directly.
const installers = fs.existsSync(OUT_DIR)
  ? fs.readdirSync(OUT_DIR).filter((f) => f.toLowerCase().endsWith(".exe"))
  : [];

if (installers.length === 0) {
  console.error("\nPackaging reported success but produced no .exe in dist/.");
  process.exit(1);
}

// ── 2. Sign ────────────────────────────────────────────────────────
if (!canSign) {
  console.log("\nNo signing certificate at certs/sess-agent-signing.pfx.");
  console.log("Installer is UNSIGNED. Run `npm run make-cert`, then `npm run dist` again.");
} else {
  for (const f of installers) {
    console.log("");
    try {
      execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path.join(__dirname, "sign.ps1"),
          "-Path",
          path.join(OUT_DIR, f),
          // Passed explicitly rather than defaulted inside the script.
          "-Pfx",
          PFX,
          "-PasswordFile",
          PWD_FILE,
        ],
        { cwd: ROOT, stdio: "inherit" },
      );
    } catch {
      console.error(`\nSigning failed for ${f}.`);
      process.exit(1);
    }
  }
}

console.log("\nProduced:");
for (const f of installers) {
  const st = fs.statSync(path.join(OUT_DIR, f));
  console.log(
    `  dist/${f}  (${(st.size / 1024 / 1024).toFixed(1)} MB)${canSign ? " [signed]" : " [UNSIGNED]"}`,
  );
}

if (canSign) {
  console.log(
    "\nEach target machine still needs the ONE-TIME certificate import before\n" +
      "this installer runs without a publisher warning - see README.md,\n" +
      "'Per-machine trust (one time, per site)'.",
  );
}
