/** Bounded protocol-v2 framing for OMP's NDJSON RPC transport. */
import { isRecord } from "../type-guards";
export const MAX_RPC_FRAME_BYTES = 1024 * 1024;
export const MAX_RPC_REASSEMBLED_BYTES = 64 * 1024 * 1024;
const RPC_CHUNK_PAYLOAD_BYTES = 256 * 1024;

export type RpcProtocolVersion = 1 | 2;
export type RpcFrameRecord = { type: string; [key: string]: unknown };

interface PendingChunks {
  chunkId: string;
  count: number;
  byteLength: number;
  nextIndex: number;
  chunks: Buffer[];
  receivedBytes: number;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function lineByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8") + 1;
}

function decodeBase64(value: unknown): Buffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) throw new Error("invalid RPC chunk data");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new Error("invalid RPC chunk data");
  return bytes;
}

/** Decodes complete logical frames from parsed JSONL records. */
export class RpcFrameDecoder {
  private pending: PendingChunks | undefined;

  push(value: unknown): RpcFrameRecord | undefined {
    if (!isRecord(value) || value.type !== "rpc_chunk") {
      if (this.pending) throw new Error("RPC chunk sequence interrupted");
      if (!isRecord(value) || typeof value.type !== "string") throw new Error("RPC frame must be an object");
      return value as RpcFrameRecord;
    }
    const { chunkId, index, count, byteLength } = value;
    if (
      typeof chunkId !== "string" || chunkId.length === 0 || chunkId.length > 128 ||
      !isSafeInteger(index) || !isSafeInteger(count) || !isSafeInteger(byteLength) ||
      index < 0 || count < 2 || count > Math.ceil(MAX_RPC_REASSEMBLED_BYTES / RPC_CHUNK_PAYLOAD_BYTES) ||
      index >= count || byteLength < MAX_RPC_FRAME_BYTES || byteLength > MAX_RPC_REASSEMBLED_BYTES
    ) throw new Error("invalid RPC chunk metadata");

    const bytes = decodeBase64(value.data);
    if (bytes.byteLength > RPC_CHUNK_PAYLOAD_BYTES) throw new Error("RPC chunk payload exceeds the transport limit");
    if (!this.pending) {
      if (index !== 0) throw new Error("RPC chunk sequence must start at index 0");
      this.pending = { chunkId, count, byteLength, nextIndex: 0, chunks: [], receivedBytes: 0 };
    }
    const pending = this.pending!;
    if (pending.chunkId !== chunkId || pending.count !== count || pending.byteLength !== byteLength || pending.nextIndex !== index) {
      throw new Error("RPC chunk sequence mismatch");
    }
    pending.chunks.push(bytes);
    pending.receivedBytes += bytes.byteLength;
    pending.nextIndex++;
    if (pending.receivedBytes > pending.byteLength) throw new Error("RPC chunk sequence exceeds declared length");
    if (pending.nextIndex < pending.count) return undefined;
    if (pending.receivedBytes !== pending.byteLength) throw new Error("RPC chunk sequence length mismatch");

    this.pending = undefined;
    const json = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(pending.chunks));
    const frame: unknown = JSON.parse(json);
    if (!isRecord(frame) || typeof frame.type !== "string") throw new Error("RPC frame must be an object");
    return frame as RpcFrameRecord;
  }
}

/** Physical JSONL records for a logical RPC frame at the selected protocol. */
export function encodeRpcFrames(frame: RpcFrameRecord, protocolVersion: RpcProtocolVersion, chunkId: string): string[] {
  const json = JSON.stringify(frame);
  if (lineByteLength(json) <= MAX_RPC_FRAME_BYTES) return [`${json}\n`];
  if (protocolVersion === 1) throw new Error("RPC frame exceeds the v1 transport limit");
  const bytes = Buffer.from(json, "utf8");
  if (bytes.byteLength > MAX_RPC_REASSEMBLED_BYTES) throw new Error("RPC frame exceeds the v2 reassembly limit");
  const count = Math.ceil(bytes.byteLength / RPC_CHUNK_PAYLOAD_BYTES);
  const lines: string[] = [];
  for (let index = 0; index < count; index++) {
    const chunk = {
      type: "rpc_chunk", chunkId, index, count, byteLength: bytes.byteLength,
      data: bytes.subarray(index * RPC_CHUNK_PAYLOAD_BYTES, (index + 1) * RPC_CHUNK_PAYLOAD_BYTES).toString("base64"),
    };
    const line = JSON.stringify(chunk);
    if (lineByteLength(line) > MAX_RPC_FRAME_BYTES) throw new Error("RPC chunk exceeds the transport limit");
    lines.push(`${line}\n`);
  }
  return lines;
}
