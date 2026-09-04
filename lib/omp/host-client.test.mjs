// Route 2 (doc 16): the typed HostClient boundary — Node business code reaches
// the Rust host only through hostClient.* (sessions/journal/host). Real host
// round trips over the shared manager (same binary the server uses).
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hostBin = join(root, "crates", "target", "debug", "ompweb-host");
const jiti = createJiti(import.meta.url);
const { hostClient, rustBackendActive } = await jiti.import("./host-client.ts");
const { shutdownRustHost } = await jiti.import("./rust-rpc-process.ts");

// Journal isolation: host inherits OMPWEB_RUNTIME_DB at boot; set it before
// the first hostClient call so no test touches the real runtime journal.
const runtimeDb = join(tmpdir(), `omp-host-client-${process.pid}.db`);
process.env.OMPWEB_RUNTIME_DB = runtimeDb;

function makeSessionFixture() {
  const dir = mkdtempSync(join(tmpdir(), "hostclient-sessions-"));
  execFileSync("node", [join(root, "scripts", "gen-session-fixtures.mjs"), "--out", dir], { stdio: "ignore" });
  return join(dir, "sessions");
}

test("hostClient.sessions: scan/rename/delete round trip through the typed boundary", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, async (t) => {
  const sessionsRoot = makeSessionFixture();
  t.after(() => rmSync(join(sessionsRoot, ".."), { recursive: true, force: true }));
  const scan = await hostClient.sessions.scan(sessionsRoot);
  assert.equal(scan.length, 3);
  assert.ok(scan.every((p) => typeof p.path === "string" && p.path.length > 0 && Number.isFinite(p.mtime_ms)));
  const first = scan[0];
  await hostClient.sessions.rename(sessionsRoot, first.path, "renamed via hostClient");
  const rescan = await hostClient.sessions.scan(sessionsRoot);
  assert.equal(rescan.find((p) => p.path === first.path)?.title, "renamed via hostClient");
  await hostClient.sessions.delete(sessionsRoot, first.path);
  const rescan2 = await hostClient.sessions.scan(sessionsRoot);
  assert.equal(rescan2.length, 2);
});

test("hostClient.journal: append assigns increasing seqs, view reads them back", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, async () => {
  const stream = `host-client-${process.pid}`;
  const seq1 = await hostClient.journal.append(stream, { payload: "{\"type\":\"a\"}" });
  const seq2 = await hostClient.journal.append(stream, { class: "coalesced", payload: "{\"type\":\"b\"}" });
  assert.equal(seq1, 1);
  assert.equal(seq2, 2);
  const seqs = await hostClient.journal.view(stream);
  assert.deepEqual(seqs, [1, 2]);
});

test("hostClient.host: status reports the resolved binary; repair/orphans are safe no-ops when clean", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, () => {
  const status = hostClient.host.status();
  assert.equal(status.available, true);
  assert.ok(["explicit", "packaged", "workspace"].includes(status.mode), `mode ${status.mode}`);
  assert.ok(status.path.length > 0);
  const repair = hostClient.host.repair();
  assert.equal(typeof repair.stoppedOrphanHosts, "number");
  assert.ok(Array.isArray(repair.orphanHostPids));
  assert.ok(Array.isArray(hostClient.host.orphans()));
});


test("hostClient: rustBackendActive reflects the explicit rollback flag only", () => {
  const saved = process.env.OMPWEB_BACKEND;
  try {
    delete process.env.OMPWEB_BACKEND;
    assert.equal(rustBackendActive(), true);
    process.env.OMPWEB_BACKEND = "node";
    assert.equal(rustBackendActive(), false);
    process.env.OMPWEB_BACKEND = "rust";
    assert.equal(rustBackendActive(), true);
  } finally {
    if (saved === undefined) delete process.env.OMPWEB_BACKEND;
    else process.env.OMPWEB_BACKEND = saved;
  }
});

test("hostClient: shared host shuts down explicitly after the suite", async () => {
  // Boot once more through the boundary, then release the host process so
  // the test runner is not held open by the live supervisor.
  const status = hostClient.host.status();
  assert.equal(status.available, true);
  await shutdownRustHost();
});
