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
});

// Native folder picker bridge (SessionSidebar's DirectoryPicker prefers it
// when available; the web browser keeps its own in-page picker).
contextBridge.exposeInMainWorld("piDesktop", {
  isDesktop: true,
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  getSplashPref: () => ipcRenderer.invoke("get-splash-pref"),
  setSplashPref: (mode) => ipcRenderer.invoke("set-splash-pref", mode),
});
