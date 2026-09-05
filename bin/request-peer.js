"use strict";

// Preloaded by our launchers before Next starts. NextRequest omits socket IP;
// stamp it at the HTTP boundary, overwriting any client-supplied values.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { randomBytes, createHmac, timingSafeEqual } = require("node:crypto");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Server } = require("node:http");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isIP } = require("node:net");
const PEER_HEADER = "x-ompweb-socket-peer";
const PROOF_HEADER = "x-ompweb-socket-proof";
const INSTALLED = Symbol.for("ompweb.requestPeerTracking");

function verifiedRequestPeer(headers) {
  const peer = headers.get(PEER_HEADER);
  const proof = headers.get(PROOF_HEADER);
  const secret = process.env.OMPWEB_PEER_SECRET;
  if (!secret || !peer || !isIP(peer) || !proof || !/^[a-f0-9]{64}$/.test(proof)) return null;
  const expected = createHmac("sha256", secret).update(peer).digest();
  return timingSafeEqual(expected, Buffer.from(proof, "hex")) ? peer : null;
}

function installRequestPeerTracking() {
  if (Server.prototype[INSTALLED]) return;
  const secret = randomBytes(32).toString("hex");
  process.env.OMPWEB_PEER_SECRET = secret;
  const emit = Server.prototype.emit;
  Object.defineProperty(Server.prototype, INSTALLED, { value: true });
  Server.prototype.emit = function (event, ...args) {
    if (event === "request" && args[0]?.headers) {
      const request = args[0];
      delete request.headers[PEER_HEADER];
      delete request.headers[PROOF_HEADER];
      const peer = request.socket?.remoteAddress;
      if (peer && isIP(peer)) {
        request.headers[PEER_HEADER] = peer;
        request.headers[PROOF_HEADER] = createHmac("sha256", secret).update(peer).digest("hex");
      }
    }
    return emit.call(this, event, ...args);
  };
}

module.exports = { installRequestPeerTracking, verifiedRequestPeer };
