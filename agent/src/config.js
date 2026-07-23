"use strict";

/**
 * Config persistence — server URL, agent token, and any unsent batches.
 *
 * Stored in the OS's standard per-user app-data directory, never hardcoded and
 * never inside the app bundle:
 *   Windows  %APPDATA%\sess-idle-agent\config.json
 *   macOS    ~/Library/Application Support/sess-idle-agent/config.json
 *   Linux    ~/.config/sess-idle-agent/config.json
 *
 * The token is a credential. It is written with 0600 where the platform
 * supports it, so other users on a shared machine cannot read it.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const APP_DIR_NAME = "sess-idle-agent";

function configDir() {
  if (process.platform === "win32")
    return path.join(process.env.APPDATA || os.homedir(), APP_DIR_NAME);
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", APP_DIR_NAME);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), APP_DIR_NAME);
}

function configPath() {
  return path.join(configDir(), "config.json");
}

const EMPTY = { serverUrl: "", token: "", paused: false, buffer: [] };

function load() {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    return { ...EMPTY, ...parsed };
  } catch {
    // Missing or corrupt — start fresh rather than crashing on boot.
    return { ...EMPTY };
  }
}

function save(cfg) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = configPath();
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600); // no-op on Windows, meaningful elsewhere
  } catch {
    /* best effort */
  }
}

/** True once both the server URL and a token are present. */
function isConfigured(cfg) {
  return Boolean(cfg && cfg.serverUrl && cfg.token);
}

module.exports = { load, save, configPath, configDir, isConfigured, EMPTY };
