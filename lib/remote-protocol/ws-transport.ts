/**
 * Real WebSocket transports for the Remote v1 protocol (doc 15 / v4 R3):
 * the host connection previously ran over an in-memory duplex pipe; these
 * adapters run the exact same MessageTransport contract over actual network
 * sockets, so handshake/resume/receipt semantics are exercised over real
 * transport behavior (framing, close codes, backpressure via ws).
 *
 * Server side uses the `ws` package (standard, battle-tested); the client
 * side uses Node's built-in WebSocket (undici) — zero extra client deps.
 */
import type { MessageTransport } from "./host-connection";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket as WsWebSocket } from "ws";

/** Server-side adapter: one transport per accepted socket. */
export function createWsServerTransport(socket: WsWebSocket): MessageTransport {
  // Multi-handler: the protocol layer and diagnostics/test spies can both
  // subscribe without clobbering each other.
  const messageHandlers = new Set<(text: string) => void>();
  const closeHandlers = new Set<() => void>();

  socket.on("message", (data, isBinary) => {
    if (isBinary) return; // v1 is text-framed; binary lands in P5
    const text = data.toString();
    for (const handler of messageHandlers) handler(text);
  });
  socket.on("close", () => {
    for (const handler of closeHandlers) handler();
  });

  return {
    send(text) {
      if (socket.readyState === socket.OPEN) socket.send(text);
    },
    onMessage(handler) {
      messageHandlers.add(handler);
    },
    close(code = 1000, reason = "") {
      try {
        socket.close(code, reason);
      } catch {
        /* already closed */
      }
    },
    onClose(handler) {
      closeHandlers.add(handler);
    },
  };
}

/**
 * Client-side adapter over Node's built-in WebSocket (global, undici).
 * `url` example: ws://127.0.0.1:PORT — plus optional protocol header set.
 */
export function createWsClientTransport(url: string, protocols?: string[]): MessageTransport {
  const ws = new globalThis.WebSocket(url, protocols);
  const messageHandlers = new Set<(text: string) => void>();
  const closeHandlers = new Set<() => void>();

  ws.addEventListener("message", (event) => {
    const text = typeof event.data === "string" ? event.data : String(event.data);
    for (const handler of messageHandlers) handler(text);
  });
  ws.addEventListener("close", () => {
    for (const handler of closeHandlers) handler();
  });

  return {
    send(text) {
      if (ws.readyState === globalThis.WebSocket.OPEN) ws.send(text);
    },
    onMessage(handler) {
      messageHandlers.add(handler);
    },
    close(code = 1000, reason = "") {
      try {
        ws.close(code, reason);
      } catch {
        /* already closed */
      }
    },
    onClose(handler) {
      closeHandlers.add(handler);
    },
  };
}

/**
 * Attach a WebSocketServer to an existing http server; returns the raw
 * server so tests/embedders can control lifecycle. The caller wires
 * per-socket HostConnection instances via the `connection` callback.
 */
export function attachWsEndpoint(
  httpServer: HttpServer,
  onConnection: (transport: MessageTransport) => void,
): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/remote/v1" });
  wss.on("connection", (socket) => {
    onConnection(createWsServerTransport(socket));
  });
  return wss;
}
