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

test("host ipc: git status/branches/checkout round trip with containment (route 10)", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, async () => {
  const { child, port, token } = await bootHost();
  const dir = join(tmpdir(), `omp-git-ipc-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(dir, "a.txt"), "one");
  execFileSync("git", ["init", "-b", "main", dir], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "add", "a.txt"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "commit", "-m", "initial"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "checkout", "-b", "feature"], { stdio: "ignore" });
  try {
    const client = await connect(port);
    await client.request("1", "hello", { token });
    const roots = [dir];
    const status = await client.request("2", "git.status", { roots, cwd: dir });
    assert.equal(status.ok, true, JSON.stringify(status));
    assert.equal(status.result.isGitRepository, true);
    assert.equal(status.result.branch, "feature");
    const branches = await client.request("3", "git.branches", { roots, cwd: dir });
    assert.equal(branches.ok, true);
    assert.deepEqual(branches.result, [{ name: "feature", current: true }, { name: "main", current: false }]);
    const checkout = await client.request("4", "git.checkout", { roots, cwd: dir, branch: "main" });
    assert.equal(checkout.ok, true);
    assert.equal(checkout.result.branch, "main");
    // containment: a cwd outside roots → access_denied
    const denied = await client.request("5", "git.status", { roots, cwd: "/etc" });
    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, "access_denied");
    client.socket.end();
  } finally {
    child.kill();
  }
});

/** Open a streaming request on its own socket and collect events until the
 *  stream ends (used for pty.attach and agent.attach-style arms). */
function attachStream(port, token, method, params) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let buffer = "";
    const events = [];
    socket.on("connect", () => {
      socket.write(JSON.stringify({ id: "s-hello", method: "hello", params: { token } }) + "\n");
      socket.write(JSON.stringify({ id: "s", method, params }) + "\n");
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.event) events.push(msg.event);
        if (msg.event && msg.event.type === "exit") socket.destroy();
      }
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(events));
  });
}

test("host ipc: pty spawn/attach/write/kill round trip (route 8)", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, async () => {
  const { child, port, token } = await bootHost();
  const dir = join(tmpdir(), `omp-pty-ipc-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    const client = await connect(port);
    await client.request("1", "hello", { token });
    const roots = [dir];
    const spawned = await client.request("2", "pty.spawn", { roots, cwd: dir, cols: 100, rows: 40 });
    assert.equal(spawned.ok, true, JSON.stringify(spawned));
    const ptyId = spawned.result.id;
    assert.match(ptyId, /^term-/);

    // Open a SECOND socket for the attach stream (one in-flight request per
    // connection, mirroring the client's dedicated attach socket).
    const eventsPromise = attachStream(port, token, "pty.attach", { id: ptyId });
    // Give the attach a moment, then write through the control socket.
    await new Promise((r) => setTimeout(r, 300));
    const written = await client.request("3", "pty.write", { id: ptyId, data: "echo pty-ipc-ok\r" });
    assert.equal(written.ok, true, JSON.stringify(written));
    const resized = await client.request("4", "pty.resize", { id: ptyId, cols: 120, rows: 50 });
    assert.equal(resized.ok, true);
    await new Promise((r) => setTimeout(r, 800));
    const killed = await client.request("5", "pty.kill", { id: ptyId });
    assert.equal(killed.ok, true);
    const events = await Promise.race([eventsPromise, new Promise((r) => setTimeout(() => r([]), 4000))]);
    const dataText = events.filter((e) => e.type === "data").map((e) => e.data).join("");
    assert.match(dataText, /pty-ipc-ok/);
    assert.ok(events.some((e) => e.type === "exit"), "attach stream must end with an exit event");
    client.socket.end();
  } finally {
    child.kill();
  }
});

test("host ipc: commands.run wait + detach with containment (route 12)", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, async () => {
  const { child, port, token } = await bootHost();
  const dir = join(tmpdir(), `omp-cmd-ipc-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    const client = await connect(port);
    await client.request("1", "hello", { token });
    const roots = [dir];
    const wait = await client.request("2", "commands.run", { roots, cwd: dir, command: "printf 'cmd-ipc-ok'", detach: false });
    assert.equal(wait.ok, true, JSON.stringify(wait));
    assert.equal(wait.result.mode, "wait");
    assert.equal(wait.result.output, "cmd-ipc-ok");
    assert.equal(wait.result.exitCode, 0);
    const detach = await client.request("3", "commands.run", { roots, cwd: dir, command: "printf 'bg' > /dev/null; sleep 0.1", detach: true });
    assert.equal(detach.ok, true, JSON.stringify(detach));
    assert.equal(detach.result.mode, "detach");
    assert.equal(typeof detach.result.pid, "number");
    assert.match(detach.result.logPath, /\.omp\/scripts-logs\//);
    const denied = await client.request("4", "commands.run", { roots, cwd: "/etc", command: "echo x", detach: false });
    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, "access_denied");
    client.socket.end();
  } finally {
    child.kill();
  }
});

test("host ipc: files list/read/meta round trip with containment (route 9)", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, async () => {
  const { child, port, token } = await bootHost();
  const dir = join(tmpdir(), `omp-files-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "sub"), { recursive: true });
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  mkdirSync(join(dir, "zeta-dir"), { recursive: true });
  mkdirSync(join(dir, "alpha-dir"), { recursive: true });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(dir, "b.txt"), "hello");
  writeFileSync(join(dir, "a.ts"), "export const x = 1;");
  try {
    const client = await connect(port);
    await client.request("1", "hello", { token });
    const roots = [dir];
    // list: dirs first, ignored names dropped, path echoed
    const list = await client.request("2", "files.list", { roots, path: dir });
    assert.equal(list.ok, true, JSON.stringify(list));
    assert.deepEqual(list.result.entries.map((e) => e.name), ["alpha-dir", "sub", "zeta-dir", "a.ts", "b.txt"]);
    assert.equal(list.result.path, dir);
    // read: content + language + size
    const read = await client.request("3", "files.read", { roots, path: join(dir, "a.ts") });
    assert.equal(read.ok, true, JSON.stringify(read));
    assert.equal(read.result.content, "export const x = 1;");
    assert.equal(read.result.language, "typescript");
    assert.equal(read.result.size, 19);
    // meta
    const meta = await client.request("4", "files.meta", { roots, path: join(dir, "a.ts") });
    assert.equal(meta.ok, true, JSON.stringify(meta));
    assert.equal(meta.result.language, "typescript");
    assert.equal(meta.result.previewKind, null);
    // containment: outside roots → access_denied
    const denied = await client.request("5", "files.read", { roots, path: "/etc/passwd" });
    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, "access_denied");
    // missing file → file_not_found
    const missing = await client.request("6", "files.read", { roots, path: join(dir, "nope.txt") });
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, "file_not_found");
    client.socket.end();
  } finally {
    child.kill();
  }
});
