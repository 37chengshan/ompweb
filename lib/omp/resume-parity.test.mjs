// Route 4 (doc 16): resume parity between the Node RpcProcess path and the
// Rust supervisor path. Regression for the verified production defect: the
// Rust path dropped extraArgs (--resume) entirely, so continuing a real
// session under the default backend started a FRESH omp session (wrong id →
// session-split error or silent fork). The supervisor now forwards spawn
// args verbatim and replays them on crash restart.
//
// Substrate: a minimal real-format session file (title slot + session +
// model_change + thinking_level_change — the exact header shape omp 18
// accepts for --resume, verified against a real session; message-less files
// avoid transcript-rebuild paths).
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hostBin = join(root, "crates", "target", "debug", "ompweb-host");
const hasOmp = process.env.OMP_WEB_OMP_BIN
  ? existsSync(process.env.OMP_WEB_OMP_BIN)
  : ["/Users/cc/.bun/bin/omp", "/opt/homebrew/bin/omp", "/usr/local/bin/omp"].some((p) => existsSync(p));
const jiti = createJiti(import.meta.url);

export const RESUME_SESSION_ID = "11111111-2222-4333-8444-555555555555";

function padTitle(title) {
  const line = `{"type":"title","v":1,"title":${JSON.stringify(title)},"updatedAt":"2026-09-02T00:00:00.000Z","pad":"   "}`;
  // Fixed 256-byte title slot (incl. trailing newline), matching omp layout.
  return line.padEnd(255, " ").slice(0, 255) + "\n";
}

export function buildResumeFixture(dir) {
  const file = join(dir, "resume-session.jsonl");
  const ts = "2026-09-02T00:00:00.000Z";
  const lines = [
    padTitle("resume parity fixture"),
    JSON.stringify({ type: "session", version: 3, id: RESUME_SESSION_ID, timestamp: ts, cwd: dir }),
    JSON.stringify({ type: "model_change", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", parentId: null, timestamp: ts, model: "omp-test/resume-probe" }),
    JSON.stringify({ type: "thinking_level_change", id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", parentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", timestamp: ts, thinkingLevel: "high", configured: null }),
  ];
  writeFileSync(file, lines.join("\n") + "\n", "utf8");
  return file;
}

async function resumeThroughNode(filePath, cwd) {
  const { RpcProcess } = await jiti.import("./rpc-process.ts");
  const proc = new RpcProcess({ cwd, extraArgs: ["--resume", filePath], onFrame: () => {} });
  try {
    const ready = await proc.waitReady(60_000);
    await proc.negotiateProtocol(ready);
    const state = await proc.sendCommand({ type: "get_state" });
    return { sessionId: state?.sessionId ?? null };
  } finally {
    await proc.dispose();
  }
}

async function resumeThroughRust(filePath, cwd) {
  const { createRpcProcess } = await jiti.import("./rust-rpc-process.ts");
  // createRpcProcess is the production factory (rpc-manager path): extraArgs
  // carry --resume exactly like the Node path.
  const proc = await createRpcProcess({ cwd, sessionId: RESUME_SESSION_ID, extraArgs: ["--resume", filePath] });
  try {
    const ready = await proc.waitReady(60_000);
    await proc.negotiateProtocol(ready);
    const state = await proc.sendCommand({ type: "get_state" });
    return { sessionId: state?.sessionId ?? null };
  } finally {
    await proc.dispose();
  }
}

const skip = !existsSync(hostBin) ? "ompweb-host binary not built" : !hasOmp ? "omp binary not found" : false;

test("resume parity: Node path resumes the fixture session id (control)", { skip }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "omp-resume-node-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = buildResumeFixture(dir);
  const { sessionId } = await resumeThroughNode(file, dir);
  assert.equal(sessionId, RESUME_SESSION_ID, "Node --resume keeps the session identity");
});

test("resume parity: Rust supervisor path resumes the same session id (route 4 fix)", { skip }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "omp-resume-rust-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = buildResumeFixture(dir);
  const { sessionId } = await resumeThroughRust(file, dir);
  assert.equal(sessionId, RESUME_SESSION_ID, "Rust spawn must forward --resume verbatim (was: fresh session id)");
});
