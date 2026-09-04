import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { pruneConfigProviderRefs } = await jiti.import("./model-roles.ts");

function withAgentDir(run) {
  const dir = mkdtempSync(join(tmpdir(), "omp-web-model-roles-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    run(dir);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

const CONFIG_WITH_REFS = `modelRoles:
  smol: sync-probe/probe-alpha:max
  slow: new-provider/poolside/laguna-s-2.1-free:xhigh
  task: openai/gpt-5.2
retry:
  fallbackChains:
    default:
      - sync-probe/probe-beta
      - new-provider/deepseek/deepseek-v4-flash
providers:
  webSearchOrder:
    - sync-probe
    - openai
    - other-gw
`;

test("prunes modelRoles, fallback chains and webSearchOrder referencing removed providers", () => {
  withAgentDir((dir) => {
    writeFileSync(join(dir, "config.yml"), CONFIG_WITH_REFS, "utf8");
    pruneConfigProviderRefs(["new-provider", "openai"]);

    const out = readFileSync(join(dir, "config.yml"), "utf8");
    // Role that pointed at sync-probe is gone.
    assert.doesNotMatch(out, /smol:/);
    // Roles whose provider is still live are preserved verbatim — including a
    // model id that itself contains slashes under a live provider.
    assert.match(out, /slow: new-provider\/poolside\/laguna-s-2\.1-free:xhigh/);
    assert.match(out, /task: openai\/gpt-5\.2/);
    // Fallback chain entry for the dead provider pruned; live one kept.
    assert.doesNotMatch(out, /sync-probe\/probe-beta/);
    assert.match(out, /new-provider\/deepseek\/deepseek-v4-flash/);
    // webSearchOrder keeps only still-live providers (its schema holds
    // provider names that must exist — anything else is pruned too).
    assert.doesNotMatch(out, /- sync-probe/);
    assert.doesNotMatch(out, /- other-gw/);
    assert.match(out, /- openai/);
  });
});

test("prunes an entire modelRoles block when every role referenced the removed provider", () => {
  withAgentDir((dir) => {
    writeFileSync(join(dir, "config.yml"), "modelRoles:\n  smol: sync-probe/a\n  slow: sync-probe/b\n", "utf8");
    pruneConfigProviderRefs([]);
    const out = readFileSync(join(dir, "config.yml"), "utf8");
    assert.doesNotMatch(out, /modelRoles:/);
  });
});

test("leaves the file byte-identical when nothing references the removed provider", () => {
  withAgentDir((dir) => {
    writeFileSync(join(dir, "config.yml"), CONFIG_WITH_REFS, "utf8");
    pruneConfigProviderRefs(["sync-probe", "new-provider", "openai", "other-gw"]);
    assert.equal(readFileSync(join(dir, "config.yml"), "utf8"), CONFIG_WITH_REFS);
  });
});

test("handles a missing config.yml and invalid YAML without throwing", () => {
  withAgentDir((dir) => {
    pruneConfigProviderRefs(["sync-probe"]); // no file — no-op
    writeFileSync(join(dir, "config.yml"), "modelRoles: [unclosed\n", "utf8");
    pruneConfigProviderRefs(["sync-probe"]); // malformed — no-op
    assert.ok(existsSync(join(dir, "config.yml")));
  });
});
