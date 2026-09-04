import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

// Route 14/20 slice 1 gate: the RemoteProtocolAdapter performs the full
// handshake + an agent.prompt mutation against the REAL Rust RemoteRuntime
// (host --ipc → device.issue/enroll via IPC → WS connect with device proof).

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hostBin = join(root, "crates", "target", "debug", "ompweb-host");

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { RemoteProtocolAdapter, AdapterUnavailableError } = await jiti.import("./client/remote-adapter.ts");

function ipcRequest(port, token, method, params) {
  return new Promise((resolve, reject) => {
    const sock = createConnection({ host: "127.0.0.1", port });
    let buf = "";
    sock.on("connect", () => {
      sock.write(JSON.stringify({ id: "1", method: "hello", params: { token } }) + "\n");
      sock.write(JSON.stringify({ id: "2", method, params }) + "\n");
    });
    sock.on("data", (c) => {
      buf += c.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.id === "2") {
          sock.end();
          resolve(msg);
        }
      }
    });
    sock.on("error", reject);
  });
}

test("remote adapter: full WS handshake + prompt mutation against the rust runtime", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, async () => {
  const host = spawn(hostBin, ["--ipc"], { stdio: ["ignore", "pipe", "inherit"] });
  const boot = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("boot timeout")), 6000);
    host.stdout.on("data", (c) => {
      buf += c.toString();
      const idx = buf.indexOf("\n");
      if (idx >= 0) {
        clearTimeout(timer);
        resolve(JSON.parse(buf.slice(0, idx)));
      }
    });
    host.on("error", reject);
  });
  try {
    const issued = await ipcRequest(boot.port, boot.token, "device.issue", {});
    assert.equal(issued.ok, true);
    const enrolled = await ipcRequest(boot.port, boot.token, "device.enroll", {
      token: issued.result.token,
      userAgent: "Mozilla/5.0 (iPhone)",
      mobile: true,
    });
    assert.equal(enrolled.ok, true);
    const deviceId = enrolled.result.id;
    // The device's auth secret is the challenge-proof material (P0: not the
    // raw device id as a bearer credential).
    const secretResp = await ipcRequest(boot.port, boot.token, "device.authSecret", { id: deviceId });
    assert.equal(secretResp.ok, true);
    const deviceSecret = secretResp.result.secret;
    assert.ok(deviceSecret && deviceSecret.length >= 32, "device must have a per-device auth secret");

    const adapter = await RemoteProtocolAdapter.connect({ url: `ws://127.0.0.1:${boot.remotePort}/remote/v1`, deviceId, deviceSecret });
    // Unsupported surface fails closed.
    await assert.rejects(
      () => adapter.sendAgentCommand("sess-1", { type: "steer" }),
      (error) => error instanceof AdapterUnavailableError && /route 14\/20/.test(error.message),
    );
    // The prompt mutation routes into the supervisor; without a running omp
    // session the executor rejects with the supervisor error — the protocol
    // still settles the mutation as `failed` (retryable receipt semantics).
    const result = await adapter.sendAgentCommand("no-such-session", { type: "prompt", message: "hello" });
    assert.equal(result.status, "failed");
    adapter.close();
  } finally {
    host.kill();
  }
});