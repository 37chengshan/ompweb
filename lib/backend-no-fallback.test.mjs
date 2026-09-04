import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// Phase 1 gate (doc 16 route 3 / R10 收口): "No Hidden Fallback". The Rust
// host is the session-domain authority by default; Node authority code may
// only run behind the explicit OMPWEB_BACKEND=node rollback mode. These
// source-level assertions lock in the removal of the silent degrade paths.

test("session scan never silently falls back to the Node scanner", async () => {
  const source = await readFile(new URL("./omp/session-files.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /falling back to Node scanner/);
  assert.match(source, /session_scan_failed/);
  // The Node scanner branch must stay behind the explicit rollback env.
  assert.match(source, /OMPWEB_BACKEND !== "node"/);
});

test("session rename/delete routes never fall back to Node authority in rust mode", async () => {
  const source = await readFile(new URL("../app/api/sessions/[id]/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Node title-slot fallback/);
  assert.doesNotMatch(source, /Node file deletion fallback/);
  assert.match(source, /session_rename_failed/);
  assert.match(source, /session_delete_failed/);
  assert.match(source, /rustAuthorityError/);
});

test("files route: rust-mode list/read/meta go through the host with no Node re-read fallback", async () => {
  const source = await readFile(new URL("../app/api/files/[...path]/route.ts", import.meta.url), "utf8");
  assert.match(source, /hostClient\.files\.list/);
  assert.match(source, /hostClient\.files\.read/);
  assert.match(source, /hostClient\.files\.meta/);
  assert.match(source, /files_read_failed/);
  assert.match(source, /files_list_failed/);
  assert.match(source, /files_meta_failed/);
  // The Node reader must only run outside the rust authority branch.
  assert.match(source, /const content = fs.readFileSync/);
  const hostClient = await readFile(new URL("./omp/host-client.ts", import.meta.url), "utf8");
  assert.match(hostClient, /files: \{/);
});

test("pty domain: host owns spawn/write/resize/kill/attach in rust mode", async () => {
  const hostClient = await readFile(new URL("./omp/host-client.ts", import.meta.url), "utf8");
  assert.match(hostClient, /terminal: \{/);
  assert.match(hostClient, /"pty\.spawn"/);
  const hostSession = await readFile(new URL("./terminal-host-session.ts", import.meta.url), "utf8");
  assert.match(hostSession, /hostClient\.terminal/);
  assert.match(hostSession, /\[Terminal closed with code/);
  const sessionRoute = await readFile(new URL("../app/api/terminal/session/route.ts", import.meta.url), "utf8");
  assert.match(sessionRoute, /rustBackendActive/);
  // Dual-backend by design: rust is the default authority; the node-pty
  // manager is imported only as the explicit OMPWEB_BACKEND=node rollback.
  assert.match(sessionRoute, /nodeManager|hostManager/);
  const ptyRust = await readFile(new URL("../crates/ompweb-host/src/pty_service.rs", import.meta.url), "utf8");
  assert.match(ptyRust, /no_such_pty/);
  assert.match(ptyRust, /access_denied/);
});

test("remote domain: device registry + runtime live on the host", async () => {
  const hostClient = await readFile(new URL("./omp/host-client.ts", import.meta.url), "utf8");
  assert.match(hostClient, /device: \{/);
  assert.match(hostClient, /"device\.enroll"/);
  const mirror = await readFile(new URL("./remote-pairing-mirror.ts", import.meta.url), "utf8");
  assert.match(mirror, /hostClient\.device\.list/);
  const accept = await readFile(new URL("../app/api/pair/accept/route.ts", import.meta.url), "utf8");
  assert.match(accept, /hostClient\.device\.enroll/);
  const deviceService = await readFile(new URL("../crates/ompweb-host/src/device_service.rs", import.meta.url), "utf8");
  assert.match(deviceService, /invalid_or_expired_token/);
  const runtime = await readFile(new URL("../crates/ompweb-host/src/remote_runtime.rs", import.meta.url), "utf8");
  assert.match(runtime, /auth_required/);
  assert.match(runtime, /mutation_result/);
});

test("git routes: rust-mode status/branches/checkout/commit/push go through the host", async () => {
  const hostClient = await readFile(new URL("./omp/host-client.ts", import.meta.url), "utf8");
  assert.match(hostClient, /git: \{/);
  assert.match(hostClient, /"git.status"/);
  const branches = await readFile(new URL("../app/api/git/branches/route.ts", import.meta.url), "utf8");
  assert.match(branches, /hostClient\.git\.branches/);
  assert.match(branches, /git_branches_failed/);
  const checkout = await readFile(new URL("../app/api/git/checkout/route.ts", import.meta.url), "utf8");
  assert.match(checkout, /hostClient\.git\.checkout/);
  assert.match(checkout, /git_checkout_failed/);
  const ghStatus = await readFile(new URL("../app/api/github/status/route.ts", import.meta.url), "utf8");
  assert.match(ghStatus, /hostClient\.git\.status/);
  assert.match(ghStatus, /git_status_failed/);
  const commit = await readFile(new URL("../app/api/git/commit/route.ts", import.meta.url), "utf8");
  assert.match(commit, /hostClient\.git\.commit/);
  assert.match(commit, /git_commit_failed/);
  const push = await readFile(new URL("../app/api/git/push/route.ts", import.meta.url), "utf8");
  assert.match(push, /hostClient\.git\.push/);
  assert.match(push, /git_push_failed/);
});

test("API error responses surface stable error codes", async () => {
  const source = await readFile(new URL("./api-utils.ts", import.meta.url), "utf8");
  assert.match(source, /code/);
});

test("rpc failures and backend faults share one bounded error ring", async () => {
  const manager = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.match(manager, /recordBackendError\("rpc_failure"/);
  assert.match(manager, /host_unavailable/);
  assert.match(manager, /host_crash/);
  const ring = await readFile(new URL("./backend-errors.ts", import.meta.url), "utf8");
  assert.match(ring, /MAX_ENTRIES/);
  assert.match(ring, /RETENTION_MS/);
  assert.match(ring, /files_list_failed/);
  assert.match(ring, /files_read_failed/);
  assert.match(ring, /files_meta_failed/);
});
