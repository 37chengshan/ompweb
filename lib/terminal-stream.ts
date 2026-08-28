/**
 * Terminal SSE frame parsing pulled out of TerminalPanel so the protocol
 * boundary is unit-testable. The server sends one `data:`/`event:` frame per
 * blank line; keep-alive comment frames and `event:` metadata (connection
 * handshake) are not terminal output.
 */

export interface TerminalFrameResult {
  /** Terminal output chunks decoded from complete frames. */
  chunks: string[];
  /** Bytes left over after the last complete frame (partial frame). */
  rest: string;
}

export function extractTerminalStreamFrames(buffer: string): TerminalFrameResult {
  const chunks: string[] = [];
  let rest = buffer;
  let frameEnd: number;
  while ((frameEnd = rest.indexOf("\n\n")) !== -1) {
    const frame = rest.slice(0, frameEnd);
    rest = rest.slice(frameEnd + 2);
    const lines = frame.split("\n");
    // Named events (e.g. the server's `event: connected` frame) are
    // connection metadata, not terminal output — skip them.
    if (lines.some((line) => line.startsWith("event:"))) continue;
    const dataLine = lines.find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    const raw = dataLine.slice(5).trimStart();
    let chunk = raw;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.data === "string") chunk = parsed.data;
    } catch {
      // Not JSON — treat the raw line as the chunk.
    }
    if (chunk) chunks.push(chunk);
  }
  return { chunks, rest };
}