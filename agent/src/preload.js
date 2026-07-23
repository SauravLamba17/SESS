"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/**
 * Minimal, explicit bridge. contextIsolation stays on (Electron's default) and
 * the renderer gets exactly three functions — no ipcRenderer, no Node.
 */
contextBridge.exposeInMainWorld("agent", {
  getConfig: () => ipcRenderer.invoke("agent:get-config"),
  saveConfig: (serverUrl, token) =>
    ipcRenderer.invoke("agent:save-config", { serverUrl, token }),
  openConfigDir: () => ipcRenderer.invoke("agent:open-config-dir"),
});
