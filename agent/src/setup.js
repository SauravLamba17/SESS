"use strict";

/**
 * Setup window renderer. No Node access here — everything goes through the
 * three functions exposed by preload.js.
 */

const $ = (id) => document.getElementById(id);

function show(text, ok) {
  const el = $("msg");
  el.textContent = text;
  el.className = `msg ${ok ? "ok" : "err"}`;
}

async function init() {
  const cfg = await window.agent.getConfig();
  $("url").value = cfg.serverUrl || "";
  $("path").textContent = cfg.configPath;
  if (cfg.hasToken) {
    $("token").placeholder = "•••••••• (a token is already saved)";
    show("This machine is already configured. Re-saving replaces the token.", true);
  }
}

$("save").addEventListener("click", async () => {
  const res = await window.agent.saveConfig($("url").value, $("token").value);
  if (!res.ok) {
    show(res.error, false);
    return;
  }
  show("Saved. Tracking will begin — you can pause it from the tray icon.", true);
  $("token").value = "";
  setTimeout(() => window.close(), 1500);
});

$("dir").addEventListener("click", () => window.agent.openConfigDir());

init();
