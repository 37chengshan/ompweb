import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

// R7 exit gate (doc 15 / v4 R7): Rust session projection shadow vs the Node
// session-reader list path — semantic mismatch threshold 0 on the fixture
// set. Title, message count, and byte size must agree exactly.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hostBin = join(root, "crates", "target", "debug", "ompweb-host");

const jiti = createJiti(import.meta.url);

function buildFixtureRoot() {
  const dir = join(tmpdir(), `omp-proj-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync("node", [join(root, "scripts", "gen-session-fixtures.mjs"), "--out", dir], { stdio: "ignore" });
  return dir;
}

test("rust scan-sessions matches Node listAllSessions on the fixture set", { skip: !existsSync(hostBin) ? "ompweb-host binary not built (run cargo build)" : false }, async () => {
  const fixtureRoot = buildFixtureRoot();
  const sessionsRoot = join(fixtureRoot, "sessions");
  // Node path reads the root via PI_CODING_AGENT_DIR (mirrors omp layout).
  const { listAllSessions } = await jiti.import("./session-reader.ts");
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = fixtureRoot;
  let nodeList;
  try {
    nodeList = await listAllSessions();
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
  // Rust scan
  const output = execFileSync(hostBin, ["--scan-sessions", sessionsRoot], { encoding: "utf8" });
  const rustList = JSON.parse(output.trim());

  assert.equal(rustList.length, nodeList.length, "session count parity");
  const byName = (list, name) => list.find((s) => String(s.path || s.file || "").includes(name) || String(s.sessionFile || "").includes(name));

  for (const rust of rustList) {
    const fileName = rust.path.split("/").pop();
    const node = byName(nodeList, fileName);
    assert.ok(node, `node has ${fileName}`);
    // Title parity (SessionInfo.name carries the title slot).
    assert.equal(rust.title, node.name ?? "", `title parity ${fileName}`);
    // Byte parity against the on-disk file.
    assert.equal(rust.bytes, statSync(rust.path).size, `bytes parity ${fileName}`);
    // Rust message count sanity: chat-s 120 / chat-l 1200 / chat-xl 6000
    // message-type lines in the fixtures.
    assert.ok(rust.messages >= 100, `message count sane ${fileName}: ${rust.messages}`);
  }
});

test("rust scan reports malformed jsonl files without crashing", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, () => {
  const dir = join(tmpdir(), `omp-proj-bad-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "sessions"), { recursive: true });
  writeFileSync(join(dir, "sessions", "broken.jsonl"), "not json at all" + String.fromCharCode(10) + '{"type":"message","id":"trunc');
  const output = execFileSync(hostBin, ["--scan-sessions", join(dir, "sessions")], { encoding: "utf8" });
  const list = JSON.parse(output.trim());
  assert.equal(list.length, 1);
  assert.equal(list[0].lines, 2);
  assert.equal(list[0].messages, 0);
});
