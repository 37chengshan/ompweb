import assert from "node:assert/strict";
import test from "node:test";
import { createActiveGoal, formatGoalElapsed, parseActiveGoal } from "./web-mode-state.ts";

test("goal state trims its objective and keeps its start time", () => {
  assert.deepEqual(createActiveGoal("  Ship the sidebar  ", 123), {
    objective: "Ship the sidebar",
    startedAt: 123,
  });
});

test("goal state parser accepts only valid persisted goal records", () => {
  assert.deepEqual(parseActiveGoal('{"objective":"Ship it","startedAt":123}'), {
    objective: "Ship it",
    startedAt: 123,
  });
  assert.equal(parseActiveGoal('{"objective":"","startedAt":123}'), null);
  assert.equal(parseActiveGoal('{"objective":"Ship it","startedAt":"123"}'), null);
  assert.equal(parseActiveGoal("not JSON"), null);
});

test("goal elapsed formatter is stable at minute and hour boundaries", () => {
  assert.equal(formatGoalElapsed(-1), "0m");
  assert.equal(formatGoalElapsed(59_999), "0m");
  assert.equal(formatGoalElapsed(60_000), "1m");
  assert.equal(formatGoalElapsed(3_660_000), "1h 1m");
});
