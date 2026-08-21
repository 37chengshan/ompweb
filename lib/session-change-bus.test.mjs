import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./session-change-bus.ts");
}

test("delivers changed session ids to every subscriber", async () => {
  const { publishSessionsChanged, subscribeSessionsChanged } = await loadSubject();
  const first = [];
  const second = [];
  const unsubscribeFirst = subscribeSessionsChanged((ids) => first.push(ids));
  const unsubscribeSecond = subscribeSessionsChanged((ids) => second.push(ids));

  publishSessionsChanged(["a", "b"]);

  assert.deepEqual(first, [["a", "b"]]);
  assert.deepEqual(second, [["a", "b"]]);
  unsubscribeFirst();
  unsubscribeSecond();
});

test("stops delivering after unsubscribe and ignores empty batches", async () => {
  const { publishSessionsChanged, subscribeSessionsChanged } = await loadSubject();
  const seen = [];
  const unsubscribe = subscribeSessionsChanged((ids) => seen.push(ids));

  publishSessionsChanged([]);
  assert.deepEqual(seen, []);

  unsubscribe();
  publishSessionsChanged(["a"]);
  assert.deepEqual(seen, []);
});

test("a throwing subscriber does not stop the others", async () => {
  const { publishSessionsChanged, subscribeSessionsChanged } = await loadSubject();
  const seen = [];
  const unsubscribeBad = subscribeSessionsChanged(() => {
    throw new Error("subscriber blew up");
  });
  const unsubscribeGood = subscribeSessionsChanged((ids) => seen.push(ids));

  publishSessionsChanged(["a"]);

  assert.deepEqual(seen, [["a"]]);
  unsubscribeBad();
  unsubscribeGood();
});
