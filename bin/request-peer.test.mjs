import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { once } from "node:events";
import { createJiti } from "jiti";
import { installRequestPeerTracking, verifiedRequestPeer } from "./request-peer.js";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { proxy } = await jiti.import("../proxy.ts");
const { NextRequest } = await import("next/server.js");

test("actual loopback HTTP reaches proxy; unsigned Host/socket spoof cannot issue tokens", async (t) => {
  installRequestPeerTracking();
  const saved = process.env.OMP_WEB_TRUSTED_PROXY;
  delete process.env.OMP_WEB_TRUSTED_PROXY;
  t.after(() => { if (saved === undefined) delete process.env.OMP_WEB_TRUSTED_PROXY; else process.env.OMP_WEB_TRUSTED_PROXY = saved; });
  assert.equal(verifiedRequestPeer(new Headers({ "x-ompweb-socket-peer": "127.0.0.1", "x-ompweb-socket-proof": "0".repeat(64) })), null);
  const server = http.createServer((incoming, response) => {
    const request = new NextRequest("http://localhost/api/pair/token", { method: "POST", headers: incoming.headers });
    const result = proxy(request);
    response.writeHead(result.status).end(JSON.stringify({ allowed: result.headers.get("x-middleware-next") === "1", peer: verifiedRequestPeer(request.headers) }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const body = await new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port: server.address().port, headers: { host: "localhost", "x-ompweb-socket-peer": "192.0.2.1", "x-ompweb-socket-proof": "forged" } }, res => {
      let data = ""; res.on("data", chunk => data += chunk); res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
  assert.deepEqual(body, { allowed: true, peer: "127.0.0.1" });
  const remote = new NextRequest("http://192.0.2.1/api/pair/token", { method: "POST", headers: { host: "localhost", "x-ompweb-socket-peer": "127.0.0.1", "x-ompweb-socket-proof": "0".repeat(64) } });
  assert.equal(proxy(remote).status, 403);
});
