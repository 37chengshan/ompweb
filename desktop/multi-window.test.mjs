import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const main = fs.readFileSync(path.join(root, "desktop", "main.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "desktop", "preload.js"), "utf8");

test("desktop session windows reuse the singleton hosted service", () => {
  assert.match(main, /function createWindow\(\{ primary = true, sessionId = null \} = \{\}\)/);
  assert.match(main, /ipcMain\.handle\("open-session-window"/);
  assert.match(main, /createWindow\(\{ primary: false, sessionId \}\)/);
  assert.match(main, /window\.loadURL\(appUrlForSession\(sessionId\)\)/);
  assert.doesNotMatch(main, /open-session-window[\s\S]{0,900}startServer\(/);
});

test("preload exposes the bounded new-session-window bridge", () => {
  assert.match(preload, /openSessionWindow: \(sessionId\) => ipcRenderer\.invoke\("open-session-window", sessionId\)/);
});

test("desktop bridges the real app version synchronously", () => {
  // Packaged builds have no npm_package_version env, so the renderer must
  // get the version from app.getVersion() via the main process — otherwise
  // the update card would show "version unavailable" forever.
  assert.match(preload, /version: ipcRenderer\.sendSync\("desktop-app-version"\) \|\| ""/);
  assert.match(main, /ipcMain\.on\("desktop-app-version"/);
  assert.match(main, /event\.returnValue = app\.getVersion\(\)/);
});
