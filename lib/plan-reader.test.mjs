import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolvePlanArtifact } from "./plan-reader.ts";

function makeSession(root, name, withPlanMode, plans) {
  const dir = join(root, "sessions", "proj");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  const lines = [
    `{"type":"title","v":1,"title":"t","updatedAt":"2026-01-01T00:00:00.000Z","pad":"${" ".repeat(180)}"}`,
    `{"type":"session","version":3,"id":"x","timestamp":"2026-01-01T00:00:00.000Z","cwd":"${root}"}`,
  ];
  if (withPlanMode) {
    lines.push(`{"type":"custom_message","customType":"plan-mode-context","content":"Plan mode active.","display":false,"attribution":"agent","id":"pm","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z"}`);
  }
  writeFileSync(file, lines.join("\n") + "\n");
  if (plans.length > 0) {
    const local = join(dir, name.replace(".jsonl", ""), "local");
    mkdirSync(local, { recursive: true });
    plans.forEach((p) => writeFileSync(join(local, p), `# ${p}\n`));
  }
  return file;
}

test("detects plan mode and newest plan file", () => {
  const root = mkdtempSync(join(tmpdir(), "plan-reader-"));
  try {
    const file = makeSession(root, "2026-01-01T00-00-00-000Z_a.jsonl", true, [
      "old-task-plan.md",
      "new-task-plan.md",
    ]);
    const artifact = resolvePlanArtifact(file);
    assert.equal(artifact.planModeActive, true);
    assert.ok(artifact.planPath?.endsWith("new-task-plan.md"));
    assert.equal(artifact.planSlug, "new-task-plan");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a plan file marks the session as plan-active even without the context entry", () => {
  // Continuation sessions ("execute this plan") have no plan-mode-context
  // entry, but their plan document exists — the file is the authority.
  const root = mkdtempSync(join(tmpdir(), "plan-reader-"));
  try {
    const file = makeSession(root, "2026-01-01T00-00-00-000Z_b.jsonl", false, ["x-plan.md"]);
    const artifact = resolvePlanArtifact(file);
    assert.equal(artifact.planModeActive, true);
    assert.ok(artifact.planPath?.endsWith("x-plan.md"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no artifact when no local plan file exists", () => {
  const root = mkdtempSync(join(tmpdir(), "plan-reader-"));
  try {
    const file = makeSession(root, "2026-01-01T00-00-00-000Z_c.jsonl", true, []);
    const artifact = resolvePlanArtifact(file);
    assert.equal(artifact.planModeActive, true);
    assert.equal(artifact.planPath, null);
    assert.equal(artifact.planSlug, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing session file degrades to no plan", () => {
  const artifact = resolvePlanArtifact("/nonexistent/session.jsonl");
  assert.equal(artifact.planModeActive, false);
  assert.equal(artifact.planPath, null);
});
