// Runs against a staged or installed package using only Node built-ins.
// No Cargo, desktop app, OMP CLI, or user configuration is needed.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";
import { createInterface } from "node:readline";

const root = process.argv[2] ? resolve(process.argv[2]) : join(dirname(fileURLToPath(import.meta.url)), "..");
const target = `${process.platform}-${process.arch}`;
const binary = join(root, "vendor", "ompweb-host", target, process.platform === "win32" ? "ompweb-host.exe" : "ompweb-host");
const health = spawnSync(binary, ["--health"], { encoding: "utf8", timeout: 5000, windowsHide: true });
assert.equal(health.status, 0, health.error?.message ?? health.stderr);
assert.equal(JSON.parse(health.stdout).status, "ok");

const dir = mkdtempSync(join(tmpdir(), "ompweb 安装 smoke-"));
const file = join(dir, "文件 sample.txt");
writeFileSync(file, "packaged-host-ok");
const child = spawn(binary, ["--ipc"], {
  cwd: dir, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, OMPWEB_RUNTIME_DB: join(dir, "runtime.db"), OMP_WEB_REMOTE_BIND: "127.0.0.1:0" },
});
const exited = once(child, "exit");
let socket;
try {
  await new Promise((resolveSmoke, rejectSmoke) => {
    const timer = setTimeout(() => finish(new Error("packaged host smoke timed out")), 12000);
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectSmoke(error); else resolveSmoke();
    };
    child.once("error", finish);
    child.once("exit", () => finish(new Error("packaged host exited during smoke")));
    child.stderr.resume();
    const boot = createInterface({ input: child.stdout });
    boot.once("line", (line) => {
      try {
        const info = JSON.parse(line);
        assert.ok(Number.isInteger(info.port) && info.port > 0);
        assert.ok(typeof info.token === "string" && info.token.length > 0);
        socket = createConnection({ host: "127.0.0.1", port: info.port });
        socket.once("error", finish);
        socket.once("close", () => finish(new Error("packaged host disconnected")));
        const send = (id, method, params) => socket.write(JSON.stringify({ id, method, params }) + "\n");
        socket.once("connect", () => send("hello", "hello", { token: info.token }));
        createInterface({ input: socket }).on("line", (responseLine) => {
          try {
            const response = JSON.parse(responseLine);
            if (response.id === "deny") {
              assert.equal(response.ok, false, "empty roots must deny reads");
              finish();
              return;
            }
            assert.equal(response.ok, true, JSON.stringify(response.error));
            if (response.id === "hello") send("ping", "ping", {});
            else if (response.id === "ping") {
              assert.equal(response.result.pong, true);
              send("read", "files.read", { path: file, roots: [dir] });
            } else if (response.id === "read") {
              assert.equal(response.result.content, "packaged-host-ok");
              send("deny", "files.read", { path: file, roots: [] });
            }
          } catch (error) { finish(error); }
        });
      } catch (error) { finish(error); }
    });
  });
  console.log(`Packaged Rust host passed: ${target}; health, IPC auth, ping, Unicode/space path read, denied read`);
} finally {
  socket?.destroy();
  child.kill();
  await exited.catch(() => {});
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
