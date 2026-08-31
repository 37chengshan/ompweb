import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";

// R8 acceptance (doc 15 / v4 P12): the Rust supervisor must own a REAL OMP
// rpc-ui child — spawn, NDJSON frames over stdin/stdout, get_state round
// trip, and restart-on-crash — with responses equivalent to what the Node
// rpc-process produces for the same command.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hostBin = join(root, "crates", "target", "debug", "ompweb-host");
const hasOmp = process.env.OMP_WEB_OMP_BIN
  ? existsSync(process.env.OMP_WEB_OMP_BIN)
  : ["/Users/cc/.bun/bin/omp", "/opt/homebrew/bin/omp", "/usr/local/bin/omp"].some((p) => existsSync(p));

function bootHost() {
  return new Promise((resolve, reject) => {
    const child = spawn(hostBin, ["--ipc"], { stdio: ["ignore", "pipe", "inherit"] });
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("ipc boot timeout")), 5000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd >= 0) {
        clearTimeout(timer);
        resolve({ child, ...JSON.parse(buffer.slice(0, lineEnd).trim()) });
      }
    });
    child.on("error", reject);
  });
}

function connect(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const pending = [];
    const listeners = [];
    let buffer = "";
    socket.on("connect", () => {
      const request = (id, method, params) => new Promise((res) => {
        const entry = { id, res, buffer: "" };
        pending.push(entry);
        // Register the matcher BEFORE writing — a fast response must not
        // race past the listener. Buffer across chunks: a response line can
        // split on any TCP segment boundary.
        const h = (chunk) => {
          entry.buffer += chunk.toString();
          let idx;
          while ((idx = entry.buffer.indexOf("\n")) >= 0) {
            const line = entry.buffer.slice(0, idx).trim();
            entry.buffer = entry.buffer.slice(idx + 1);
            if (!line) continue;
            if (line.includes('"id":"' + id + '"') && line.includes('"ok"')) {
              socket.off("data", h);
              const pi = pending.indexOf(entry);
              if (pi >= 0) pending.splice(pi, 1);
              res(JSON.parse(line));
              return;
            }
          }
        };
        socket.on("data", h);
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
          for (const fn of listeners) fn(msg);
        }
      });
      // Raw-data hook for diagnostics (used by tests to spy).
      socket._rawSpies = [];
      resolve({ request, socket, onEvent: (fn) => listeners.push(fn) });
    });
    socket.on("error", reject);
  });
}

console.error('TRACE: start test1');
test("rust supervisor spawns real omp, get_state round trip, attach frames", { skip: !existsSync(hostBin) ? "ompweb-host binary not built (run cargo build)" : !hasOmp ? "omp binary not found" : false }, async () => {
  const { child, port, token } = await bootHost();
  console.error('TRACE: booted', port);
  try {
    const client = await connect(port);
    console.error('TRACE: connected');
    const hello = await client.request("1", "hello", { token });
    assert.equal(hello.ok, true);

    const spawnRes = await client.request("2", "agent.spawn", { cwd: "/tmp", sessionId: "r8-test-1" });
    assert.equal(spawnRes.ok, true, JSON.stringify(spawnRes));
    assert.ok(spawnRes.result.pid > 0);

    // Attach on a SEPARATE connection: the attach request blocks its
    // connection's handler until the session ends, so the control
    // connection must stay free for agent.send/kill.
    const attachClient = await connect(port);
    await attachClient.request("1", "hello", { token });
    const frames = [];
    attachClient.onEvent((msg) => {
      if (msg.event) frames.push(JSON.stringify(msg.event));
    });
    void attachClient.request("9", "agent.attach", { sessionId: "r8-test-1" }).then((r) => r).catch((e) => e);

    // get_state — the same command the Node rpc-process sends.
    const getState = await client.request("3", "agent.send", {
      sessionId: "r8-test-1",
      command: JSON.stringify({ type: "get_state", id: "w0" }),
    });
    assert.equal(getState.ok, true, JSON.stringify(getState));

    // Wait for the get_state response frame.
    const deadline = Date.now() + 15000;
    let stateFrame = null;
    while (Date.now() < deadline) {
      const candidate = frames.find((f) => {
        try {
          const parsed = JSON.parse(f);
          const frameBody = parsed.frame ?? parsed;
          return frameBody.type === "get_state" || frameBody.id === "w0"
            || (frameBody.data && frameBody.data.type === "get_state");
        } catch {
          return false;
        }
      });
      if (candidate) {
        stateFrame = JSON.parse(candidate);
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(stateFrame, "get_state response frame received, saw frames: " + frames.length);
    // Equivalent to the Node path: the response carries session state.
    // stateFrame is already parsed (JSON.parse in the find loop); it is the
    // msg.event object: { type: "frame", frame: <response> }.
    const stateEnvelope = stateFrame.frame ? stateFrame : { frame: stateFrame };
    const body = stateEnvelope.frame ?? stateEnvelope;
    const responseBody = body.data ?? body;
    assert.ok("sessionId" in responseBody || "queuedMessageCount" in responseBody || "phase" in responseBody,
      "response has session state fields: " + JSON.stringify(responseBody).slice(0, 200));

    // Clean kill: graceful exit event must arrive on attach.
    await client.request("4", "agent.kill", { sessionId: "r8-test-1" });
    const exitDeadline = Date.now() + 10000;
    let sawExit = false;
    while (Date.now() < exitDeadline) {
      if (frames.some((f) => { try { return JSON.parse(f).type === "exit"; } catch { return false; } })) {
        sawExit = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(sawExit, "exit event delivered via attach");
    attachClient.socket.end();
    client.socket.end();
  } finally {
    child.kill();
  }
}, { timeout: 60000 });

test("rust supervisor crash recovery restarts a killed omp child", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : !hasOmp ? "omp binary not found" : false }, async () => {
  const { child, port, token } = await bootHost();
  try {
    const client = await connect(port);
    await client.request("1", "hello", { token });
    const spawnRes = await client.request("2", "agent.spawn", { cwd: "/tmp", sessionId: "r8-crash-1" });
    assert.equal(spawnRes.ok, true);
    const firstPid = spawnRes.result.pid;

    const attachClient = await connect(port);
    await attachClient.request("1", "hello", { token });
    const frames = [];
    attachClient.onEvent((msg) => {
      if (msg.event) frames.push(JSON.stringify(msg.event));
    });
    void attachClient.request("9", "agent.attach", { sessionId: "r8-crash-1" }).catch(() => {});

    // Simulate an UNEXPECTED crash: SIGKILL the omp child directly (agent.kill
    // is a user kill and must NOT restart; only non-zero exits restart).
    process.kill(firstPid, "SIGKILL");
    const deadline = Date.now() + 15000;
    let restarted = null;
    while (Date.now() < deadline) {
      const hit = frames.find((f) => {
        try {
          const parsed = JSON.parse(f);
          const fb = parsed.frame ?? parsed;
          return fb.type === "session_restarted" || JSON.stringify(fb).includes("session_restarted");
        } catch {
          return false;
        }
      });
      if (hit) {
        const event = JSON.parse(hit);
        restarted = event.frame ?? event;
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.ok(restarted, "session_restarted frame observed");
    assert.equal(restarted.restarts, 1);
    assert.notEqual(restarted.pid, firstPid, "restart uses a new pid");
    // attach stays subscribed to the restarted child — closing the socket
    // ends it; do NOT await attachPromise (it resolves only on session end).
    attachClient.socket.end();
    client.socket.end();
  } finally {
    child.kill();
  }
}, { timeout: 60000 });
