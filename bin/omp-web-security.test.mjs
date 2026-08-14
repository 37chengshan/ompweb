import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("launcher refuses unauthenticated non-loopback binds", async () => {
  const source = await readFile(new URL("./omp-web.js", import.meta.url), "utf8");
  assert.match(source, /Refusing to listen on/);
  assert.match(source, /!passwordEnabled/);
});
