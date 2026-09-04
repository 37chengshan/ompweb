import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const transcript = source.slice(source.indexOf("const CommittedTranscript"), source.indexOf("export function ChatWindow"));

test("virtual transcript never feeds a ResizeObserver measurement back into scrollTop", () => {
  assert.match(transcript, /滚动位置的唯一权威/);
  assert.doesNotMatch(transcript, /scrollTop\s*\+=/);
  assert.doesNotMatch(transcript, /\.scrollTop\s*=/);
});

test("virtual transcript removes recycled observer targets and keeps callbacks stable", () => {
  assert.match(transcript, /groupRefCallbacksRef/);
  assert.match(transcript, /groupRoRef\.current\?\.unobserve\(previous\)/);
  assert.match(transcript, /if \(!el\.isConnected\)/);
  assert.match(transcript, /measuredGroupsRef\.current\.delete\(groupIdx\)/);
});

test("virtual group DOM is never reused across different sessions", () => {
  assert.match(transcript, /const virtualKeyPrefix = sessionId \?\? "new-session"/);
  assert.match(transcript, /key=\{virtualKeyPrefix \+ "-vg-" \+ g\}/);
});

test("the complete virtual transcript remounts on a sidebar session switch", () => {
  assert.match(source, /<CommittedTranscript\s+\/\/ A session switch[\s\S]*?key=\{session\?\.id \?\? sessionIdRef\.current \?\? "new-session"\}/);
});
