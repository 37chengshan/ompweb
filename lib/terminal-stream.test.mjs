import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./terminal-stream.ts");
}

test("extracts data chunks from complete SSE frames", async () => {
  const { extractTerminalStreamFrames } = await loadSubject();
  const { chunks, rest } = extractTerminalStreamFrames(
    `data: {"data":"line one"}\n\ndata: {"data":"line two"}\n\n`,
  );
  assert.deepEqual(chunks, ["line one", "line two"]);
  assert.equal(rest, "");
});

test("skips event metadata frames and keep-alive comments", async () => {
  const { extractTerminalStreamFrames } = await loadSubject();
  const { chunks, rest } = extractTerminalStreamFrames(
    `event: connected\ndata: {"sessionId":"s1"}\n\n: keep-alive\n\ndata: {"data":"after"}\n\n`,
  );
  assert.deepEqual(chunks, ["after"]);
  assert.equal(rest, "");
});

test("treats non-JSON data lines as raw chunks", async () => {
  const { extractTerminalStreamFrames } = await loadSubject();
  const { chunks } = extractTerminalStreamFrames(`data: plain text\n\n`);
  assert.deepEqual(chunks, ["plain text"]);
});

test("keeps a partial trailing frame in rest for the next read", async () => {
  const { extractTerminalStreamFrames } = await loadSubject();
  const { chunks, rest } = extractTerminalStreamFrames(`data: {"data":"a"}\n\ndata: {"da`);
  assert.deepEqual(chunks, ["a"]);
  assert.equal(rest, `data: {"da`);
});

test("ignores frames without any data line", async () => {
  const { extractTerminalStreamFrames } = await loadSubject();
  const { chunks } = extractTerminalStreamFrames(`event: ping\n\n`);
  assert.deepEqual(chunks, []);
});