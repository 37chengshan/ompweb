import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";

// C03 acceptance (doc 15 / v4 PR-C03): the ompweb-host local IPC server —
// same-user token auth, request/response, streaming frames, stable errors —
// over a real TCP socket from Node (the future adapter's transport).

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hostBin = join(root, "crates", "target", "debug", "ompweb-host");

function bootHost(env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(hostBin, ["--ipc"], { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, ...env } });
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("ipc boot timeout")), 5000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd >= 0) {
        clearTimeout(timer);
        const line = buffer.slice(0, lineEnd).trim();
        const info = JSON.parse(line);
        resolve({ child, ...info });
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function connect(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const pending = [];
    let buffer = "";
    socket.on("connect", () => {
      const request = (id, method, params) => new Promise((res) => {
        pending.push({ id, res });
        socket.write(JSON.stringify({ id, method, params }) + "\n");
      });
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          const msg = JSON.parse(line);
          const p = pending.find((entry) => entry.id === msg.id);
          if (p && (msg.ok !== undefined || msg.event)) {
            pending.splice(pending.indexOf(p), 1);
            p.res(msg);
          }
        }
      });
      resolve({ request, socket });
    });
    socket.on("error", reject);
  });
}

test("host ipc: hello auth, ping, stable unknown-method error", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, async () => {
  const { child, port, token } = await bootHost();
  try {
    const client = await connect(port);
    const hello = await client.request("1", "hello", { token });
    assert.equal(hello.ok, true);
    assert.equal(hello.result.protocol, 1);
    assert.ok(hello.result.pid > 0);

    const ping = await client.request("2", "ping", {});
    assert.equal(ping.ok, true);
    assert.equal(ping.result.pong, true);

    const bad = await client.request("3", "no.such.method", {});
    assert.equal(bad.ok, false);
    assert.equal(bad.error.code, "unknown_method");

    client.socket.end();
  } finally {
    child.kill();
  }
});

test("host ipc: bad token is rejected with auth_failed", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, async () => {
  const { child, port } = await bootHost();
  try {
    const client = await connect(port);
    const hello = await client.request("1", "hello", { token: "wrong-token" });
    assert.equal(hello.ok, false);
    assert.equal(hello.error.code, "auth_failed");
    client.socket.end();
  } finally {
    child.kill();
  }
});


test("host ipc: runtime journal append/view (R9)", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, async () => {
  // Isolated runtime DB: the journal is persistent state; the shared default
  // (~/.omp/agent/ompweb/runtime.db) would accumulate seq across runs.
  const runtimeDb = join(tmpdir(), `omp-runtime-${process.pid}.db`);
  rmSync(runtimeDb, { force: true });
  const { child, port, token } = await bootHost({ OMPWEB_RUNTIME_DB: runtimeDb });
  try {
    const client = await connect(port);
    const hello = await client.request("1", "hello", { token });
    assert.equal(hello.ok, true);
    const a1 = await client.request("2", "journal.append", { stream: "r9-test", kind: "message", payload: '{"n":1}' });
    assert.equal(a1.ok, true);
    assert.equal(a1.result.seq, 1);
    const a2 = await client.request("3", "journal.append", { stream: "r9-test", kind: "token.usage", class: "coalesced", payload: '{"n":2}' });
    assert.equal(a2.ok, true);
    assert.equal(a2.result.seq, 2);
    const view = await client.request("4", "journal.view", { stream: "r9-test" });
    assert.equal(view.ok, true);
    assert.deepEqual(view.result, [1, 2]);
    client.socket.end();
  } finally {
    child.kill();
  }
});

test("host ipc: session scan/rename/delete round trip (R10)", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, async () => {
  const { child, port, token } = await bootHost();
  const dir = join(tmpdir(), `omp-r10-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync("node", [join(root, "scripts", "gen-session-fixtures.mjs"), "--out", dir], { stdio: "ignore" });
  try {
    const client = await connect(port);
    await client.request("1", "hello", { token });
    const sessionsRoot = join(dir, "sessions");
    const scan = await client.request("2", "session.scan", { root: sessionsRoot });
    assert.equal(scan.ok, true);
    assert.equal(scan.result.length, 3);
    // Rename the first session's title slot.
    const first = scan.result[0];
    const renamed = await client.request("3", "session.rename", { root: sessionsRoot, path: first.path, title: "renamed by r10" });
    assert.equal(renamed.ok, true, JSON.stringify(renamed));
    const rescan = await client.request("4", "session.scan", { root: sessionsRoot });
    assert.equal(rescan.result[0].title, "renamed by r10");
    // Delete a session file.
    const del = await client.request("5", "session.delete", { root: sessionsRoot, path: first.path });
    assert.equal(del.ok, true);
    const rescan2 = await client.request("6", "session.scan", { root: sessionsRoot });
    assert.equal(rescan2.result.length, 2);
    client.socket.end();
  } finally {
    child.kill();
  }
});
