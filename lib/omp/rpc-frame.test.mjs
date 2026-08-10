import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeRpcFrames,
  MAX_RPC_FRAME_BYTES,
  RpcFrameDecoder,
} from "./rpc-frame.ts";

test("RPC v2 reassembles an oversized UTF-8 frame", () => {
  const frame = { type: "message_end", text: "x".repeat(MAX_RPC_FRAME_BYTES) };
  const encoded = encodeRpcFrames(frame, 2, "test-frame");
  assert.ok(encoded.length > 1);

  const decoder = new RpcFrameDecoder();
  let decoded;
  for (const line of encoded) decoded = decoder.push(JSON.parse(line));
  assert.deepEqual(decoded, frame);
});

test("RPC v2 rejects chunk reordering and v1 rejects oversized writes", () => {
  const frame = { type: "message_end", text: "x".repeat(MAX_RPC_FRAME_BYTES) };
  const encoded = encodeRpcFrames(frame, 2, "test-frame");
  const decoder = new RpcFrameDecoder();
  assert.throws(() => decoder.push(JSON.parse(encoded[1])), /start at index 0/);
  assert.throws(() => encodeRpcFrames(frame, 1, "test-frame"), /v1 transport limit/);
});
