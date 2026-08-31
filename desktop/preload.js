"use strict";

/**
 * Minimal preload: exposes the app version and window controls to the
 * renderer. The web UI itself is the same omp-web app (no bridge API
 * needed for its existing features).
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ompWebDesktop", {
  isDesktop: true,
  version: process.env.npm_package_version || "",
  minimize: () => ipcRenderer.send("window-control", "minimize"),
  maximize: () => ipcRenderer.send("window-control", "maximize"),
  close: () => ipcRenderer.send("window-control", "close"),
  // Self-update bridge (packaged builds only; dev resolves to no-ops via
  // invoke rejection, which the renderer treats as "not supported").
  updateCheck: () => ipcRenderer.invoke("desktop-update-check"),
  updateDownload: () => ipcRenderer.invoke("desktop-update-download"),
  updateApply: () => ipcRenderer.invoke("desktop-update-apply"),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("desktop-update-status", listener);
    return () => ipcRenderer.removeListener("desktop-update-status", listener);
  },
  // The splash page waits for the standalone server to answer before
  // navigating (no blank/black window while cold-starting).
  onServerReady: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("server-ready", listener);
    return () => ipcRenderer.removeListener("server-ready", listener);
  },
  // `server-ready` can arrive before splash.html installs its listener. Read
  // the latched state once after subscribing so a fast server never leaves
  // the splash waiting for an event it missed.
  isServerReady: () => ipcRenderer.invoke("desktop-server-ready-state"),
  // Terminal startup failure (doc 14 T1.4): splash shows an in-page panel
  // with the reason, log location, retry and quit.
  onServerError: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("server-error", listener);
    return () => ipcRenderer.removeListener("server-error", listener);
  },
  // Re-run the standalone server after a failure (max 3 retries).
  retryStartup: () => ipcRenderer.invoke("startup-retry"),
  // Renderer-reported startup stages (T1.3): assets_warmed (splash),
  // shell_mounted / session_interactive (Web UI).
  startupStage: (stage) => ipcRenderer.send("startup-stage", stage),
  getStartupReport: () => ipcRenderer.invoke("get-startup-report"),
});

// Native folder picker bridge (SessionSidebar's DirectoryPicker prefers it
// when available; the web browser keeps its own in-page picker).
contextBridge.exposeInMainWorld("piDesktop", {
  isDesktop: true,
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  getSplashPref: () => ipcRenderer.invoke("get-splash-pref"),
  setSplashPref: (mode) => ipcRenderer.invoke("set-splash-pref", mode),
  getAutoLaunch: () => ipcRenderer.invoke("get-auto-launch"),
  setAutoLaunch: (enabled) => ipcRenderer.invoke("set-auto-launch", enabled),
});
