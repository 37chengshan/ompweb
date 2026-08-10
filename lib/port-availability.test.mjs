import assert from "node:assert/strict";
import net from "node:net";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { isPortAvailable } = require("../bin/port-availability.js");

test("reports a port occupied by another server", async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen({ host: "127.0.0.1", port: 0 }, resolve));
  const { port } = server.address();

  try {
    assert.equal(await isPortAvailable(port, "127.0.0.1"), false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  assert.equal(await isPortAvailable(port, "127.0.0.1"), true);
});
