import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// P0 regression: the pairing gate's loopback detection must NOT trust the
// forgeable Host header. isLoopbackConnection decides purely from socket
// origin signals — a LAN attacker sending `Host: localhost` must not turn a
// remote connection into "loopback" (which would mint pairing tokens).

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { isLoopbackConnection } = await jiti.import("../proxy.ts");

function fakeRequest(headers, ip) {
  return {
    headers: {
      get(name) {
        const lower = name.toLowerCase();
        return headers[lower] ?? null;
      },
    },
    ...(ip ? { ip } : {}),
  };
}

test("pairing gate: direct-listener x-forwarded-for is never trusted", () => {
  // A LAN client can write this header itself. Without an explicitly trusted
  // reverse proxy it must not grant loopback status.
  const req = fakeRequest({ host: "localhost", "x-forwarded-for": "127.0.0.1" });
  assert.equal(isLoopbackConnection(req), false, "forgeable forwarding header must not grant loopback status");
});

test("pairing gate: runtime-resolved loopback socket is loopback regardless of Host header", () => {
  const req = fakeRequest({ host: "192.168.1.50" }, "127.0.0.1");
  assert.equal(isLoopbackConnection(req), true);
});

test("pairing gate: trusted-proxy headers only honored when explicitly enabled", () => {
  const before = process.env.OMP_WEB_TRUSTED_PROXY;
  try {
    // Without the flag, CF/XFF are not trusted and an unknown peer fails
    // closed as remote.
    delete process.env.OMP_WEB_TRUSTED_PROXY;
    const req = fakeRequest({ host: "localhost", "cf-connecting-ip": "192.168.1.5" });
    assert.equal(isLoopbackConnection(req), false, "untrusted CF header must be ignored");

    // With the flag, the trusted proxy's header wins.
    process.env.OMP_WEB_TRUSTED_PROXY = "1";
    const proxied = fakeRequest({ "cf-connecting-ip": "192.168.1.5" });
    assert.equal(isLoopbackConnection(proxied), false);
  } finally {
    if (before === undefined) delete process.env.OMP_WEB_TRUSTED_PROXY;
    else process.env.OMP_WEB_TRUSTED_PROXY = before;
  }
});

test("pairing gate: trusted proxy forwards loopback and remote addresses correctly", () => {
  const before = process.env.OMP_WEB_TRUSTED_PROXY;
  process.env.OMP_WEB_TRUSTED_PROXY = "1";
  try {
    assert.equal(isLoopbackConnection(fakeRequest({ "x-forwarded-for": "::1" })), true);
    assert.equal(isLoopbackConnection(fakeRequest({ "x-forwarded-for": "127.0.0.1" })), true);
    assert.equal(isLoopbackConnection(fakeRequest({ "x-forwarded-for": "::ffff:127.0.0.1" })), true);
    assert.equal(isLoopbackConnection(fakeRequest({ "x-forwarded-for": "10.0.0.7" })), false);
  } finally {
    if (before === undefined) delete process.env.OMP_WEB_TRUSTED_PROXY;
    else process.env.OMP_WEB_TRUSTED_PROXY = before;
  }
});
