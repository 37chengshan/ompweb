import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { RustHostManager } = await jiti.import("./rust-rpc-process.ts");

test("cold concurrent requests wait for boot and hello; socket loss rejects and reconnects", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ompweb-host-lifecycle-"));
  const fixture = join(dir, "host.mjs");
  writeFileSync(fixture, `
    import net from 'node:net';
    const server = net.createServer(socket => {
      let buffer = '', authed = false;
      socket.on('error', () => {});
      socket.on('data', chunk => {
        buffer += chunk; let newline;
        while ((newline = buffer.indexOf('\\n')) >= 0) {
          const msg = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
          if (msg.method === 'hello') authed = msg.params.token === 'fixture-token';
          if (msg.method === 'commands.run') { setTimeout(() => socket.write(JSON.stringify({ id: msg.id, ok: true, result: {} }) + '\\n'), 150); continue; }
          if (msg.method === 'disconnect') { socket.destroy(); return; }
          socket.write(JSON.stringify({ id: msg.id, ok: authed, result: { pong: true },
            error: { code: 'not_authed', message: 'hello first' } }) + '\\n');
        }
      });
    });
    setTimeout(() => server.listen(0, '127.0.0.1', () => {
      console.log(JSON.stringify({ port: server.address().port, token: 'fixture-token' }));
    }), 120);
  `);
  const previous = process.env.OMPWEB_HOST_BIN;
  process.env.OMPWEB_HOST_BIN = process.execPath; // existence check only; injected spawn owns argv
  let spawns = 0;
  const manager = new RustHostManager((_bin, _args, options) => {
    spawns += 1;
    return spawn(process.execPath, [fixture], options);
  });
  t.after(async () => {
    await manager.shutdown();
    if (previous === undefined) delete process.env.OMPWEB_HOST_BIN;
    else process.env.OMPWEB_HOST_BIN = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  const results = await Promise.all(Array.from({ length: 8 }, () => manager.controlRequest("ping", {}, 2000)));
  assert.equal(spawns, 1);
  assert.ok(results.every(value => value.pong));
  await assert.rejects(manager.controlRequest("disconnect", {}, 2000), /disconnected/);
  assert.deepEqual(await manager.controlRequest("ping", {}, 2000), { pong: true });
  assert.equal(spawns, 1, "a socket reconnect must not reboot the host");
  let scriptFinished = false;
  const script = manager.controlRequest("commands.run", {}, 2000).then(() => { scriptFinished = true; });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(await manager.controlRequest("ping", {}, 2000), { pong: true });
  assert.equal(scriptFinished, false, "a long script must not block state/cancel on the control channel");
  await script;
});
