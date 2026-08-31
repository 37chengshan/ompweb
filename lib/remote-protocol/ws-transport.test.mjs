import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { HostConnection, makeHello } = await jiti.import("./host-connection.ts");
const { createWsClientTransport, attachWsEndpoint } = await jiti.import("./ws-transport.ts");
const { MemoryJournal } = await jiti.import("../continuity/journal.ts");
const { MutationLedger } = await jiti.import("../continuity/mutations.ts");

// Real-network smoke tests (doc 15 / v4 R3): the same HostConnection state
// machine runs over an actual WebSocket — framing, close codes, and the
// hello/welcome handshake over the wire, not a memory pipe.

function startServer() {
  const httpServer = createServer();
  return new Promise((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      const address = httpServer.address();
      resolve({ httpServer, port: typeof address === "object" && address ? address.port : 0 });
    });
  });
}

// Close the server AND the wss (otherwise the http handle keeps the process
// alive after tests finish).
function shutdown(httpServer, wss) {
  return new Promise((resolve) => {
    if (wss) wss.close(() => {});
    httpServer.close(() => resolve());
    setTimeout(resolve, 500);
  });
}

test("ws endpoint accepts a client and exchanges text frames", async () => {
  const { httpServer, port } = await startServer();
  let received = null;
  let wss = null;
  const ready = new Promise((resolve) => {
    wss = attachWsEndpoint(httpServer, (transport) => {
      transport.onMessage((text) => {
        received = text;
        resolve();
      });
    });
  });
  const client = createWsClientTransport(`ws://127.0.0.1:${port}/remote/v1`);
  client.onMessage(() => {});
  await new Promise((resolve) => setTimeout(resolve, 300)); // allow open
  client.send("hello from client");
  await ready;
  assert.equal(received, "hello from client");
  client.close(1000, "done");
  await shutdown(httpServer, wss);
});

test("host connection handshake completes over a real socket", async () => {
  const { httpServer, port } = await startServer();
  const journal = new MemoryJournal({ hostEpoch: "epoch-1" });
  const ledger = new MutationLedger({ now: () => Date.now() });

  let wss = null;
  const serverFrames = [];
  const sawHello = new Promise((resolve) => {
    wss = attachWsEndpoint(httpServer, (transport) => {
      const rawSend = transport.send.bind(transport);
      transport.send = (text) => {
        serverFrames.push(text);
        rawSend(text);
      };
      new HostConnection(transport, {
        journal,
        ledger,
        serverVersion: "ompweb-host-test",
        authenticator: async () => ({ ok: true, deviceId: "dev-1" }),
        executeMutation: async () => ({ status: "committed" }),
      });
      transport.onMessage((text) => {
        serverFrames.push("in:" + text);
        const parsed = JSON.parse(text);
        if (parsed.type === "hello") resolve(parsed);
      });
    });
  });

  const clientTransport = createWsClientTransport(`ws://127.0.0.1:${port}/remote/v1`);
  new HostConnection(clientTransport, {
    journal,
    ledger,
    executeMutation: async () => ({ status: "committed" }),
  });
  clientTransport.onMessage(() => {});
  await new Promise((resolve) => setTimeout(resolve, 300));
  clientTransport.send(JSON.stringify(makeHello("dev-1")));
  const hello = await Promise.race([
    sawHello,
    new Promise((_, reject) => setTimeout(() => reject(new Error("hello timeout")), 3000)),
  ]);
  assert.equal(hello.type, "hello");
  // Server must answer with a JSON frame (auth_required or welcome).
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.ok(serverFrames.length >= 1, "server responded to hello, frames=" + serverFrames.length);
  assert.ok(serverFrames[0].startsWith("{"), "response is JSON: " + serverFrames[0].slice(0, 80));
  clientTransport.close(1000);
  await shutdown(httpServer, wss);
});

test("client transport close delivers onClose to the peer", async () => {
  const { httpServer, port } = await startServer();
  let peerClosed = false;
  let wss = null;
  const closed = new Promise((resolve) => {
    wss = attachWsEndpoint(httpServer, (transport) => {
      transport.onClose(() => {
        peerClosed = true;
        resolve();
      });
    });
  });
  const client = createWsClientTransport(`ws://127.0.0.1:${port}/remote/v1`);
  client.onMessage(() => {});
  await new Promise((resolve) => setTimeout(resolve, 300));
  client.close(1000, "bye");
  await closed;
  assert.equal(peerClosed, true);
  await shutdown(httpServer, wss);
});
