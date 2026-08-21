import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./web-slash-commands.ts");
}

test("exposes the expected command set with hints and arg requirements", async () => {
  const { WEB_SLASH_COMMANDS } = await loadSubject();
  const names = WEB_SLASH_COMMANDS.map((command) => command.name);

  assert.deepEqual(names, ["goal", "plan", "review", "fix", "test", "explain", "simplify", "commit", "advisor"]);
  assert.ok(WEB_SLASH_COMMANDS.every((command) => command.descriptionKey.startsWith("chatInput.cmd")));
  assert.ok(WEB_SLASH_COMMANDS.every((command) => command.argumentHintKey.startsWith("chatInput.cmd")));

  const required = new Set(WEB_SLASH_COMMANDS.filter((command) => command.requiresArgs).map((command) => command.name));
  assert.deepEqual(required, new Set(["goal", "plan", "fix", "test", "explain", "simplify"]));
});

test("lookup resolves by primary name only", async () => {
  const { getWebSlashCommand } = await loadSubject();
  assert.equal(getWebSlashCommand("goal")?.name, "goal");
  assert.equal(getWebSlashCommand("plan")?.name, "plan");
  assert.equal(getWebSlashCommand("vibe"), undefined);
  assert.equal(getWebSlashCommand("GOAL"), undefined);
});

test("required-arg commands embed the args verbatim", async () => {
  const { getWebSlashCommand } = await loadSubject();
  const goal = getWebSlashCommand("goal");
  assert.ok(goal);
  const prompt = goal.buildPrompt("ship the export feature");

  assert.match(prompt, /Work toward this goal for the rest of the session/);
  assert.ok(prompt.includes("ship the export feature"));
});

test("optional-arg commands degrade to a default when no args are given", async () => {
  const { getWebSlashCommand } = await loadSubject();
  const review = getWebSlashCommand("review");
  const commit = getWebSlashCommand("commit");
  assert.ok(review);
  assert.ok(commit);

  assert.match(review.buildPrompt(""), /current project state and recent changes/);
  assert.match(review.buildPrompt("lib/model-catalog.ts"), /Review lib\/model-catalog\.ts for bugs/);

  assert.match(commit.buildPrompt(""), /clear conventional commit message/);
  assert.match(commit.buildPrompt("feat: add catalog"), /commit the current changes with this message: "feat: add catalog"/);
});

test("advisor command reviews with or without a topic", async () => {
  const { getWebSlashCommand, expandWebSlashCommand } = await loadSubject();
  const advisor = getWebSlashCommand("advisor");
  assert.ok(advisor);

  assert.match(advisor.buildPrompt(""), /independent advisor reviewing the current work/);
  assert.match(advisor.buildPrompt("the retry logic"), /reviewing this work: the retry logic/);

  const expanded = expandWebSlashCommand("/advisor the retry logic");
  assert.equal(expanded.kind, "expand");
  if (expanded.kind === "expand") assert.match(expanded.prompt, /the retry logic/);
});

test("expansion expands web commands, rejects missing args, and passes others through", async () => {
  const { expandWebSlashCommand } = await loadSubject();

  const expanded = expandWebSlashCommand("/goal ship the export");
  assert.equal(expanded.kind, "expand");
  if (expanded.kind === "expand") assert.match(expanded.prompt, /ship the export/);

  const usage = expandWebSlashCommand("/goal ");
  assert.equal(usage.kind, "usage-error");
  if (usage.kind === "usage-error") {
    assert.equal(usage.command, "/goal");
    assert.equal(usage.argumentHintKey, "chatInput.cmdGoalArg");
  }

  // Plain messages and non-web commands are not the client's business.
  assert.equal(expandWebSlashCommand("just a message").kind, "not-web");
  assert.equal(expandWebSlashCommand("/compact").kind, "not-web");
  assert.equal(expandWebSlashCommand("/vibe go fast").kind, "not-web");
});
