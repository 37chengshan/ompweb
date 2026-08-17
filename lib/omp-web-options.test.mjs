import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { parseLaunchOptions } = require("../bin/omp-web-options.js");

test("opens the browser by default", () => {
  const parsed = parseLaunchOptions([], {});
  assert.equal(parsed.port, "30177");
  assert.equal(parsed.hostname, "127.0.0.1");
  assert.equal(parsed.openBrowser, true);
});

test("supports the no-open CLI option", () => {
  assert.equal(parseLaunchOptions(["--no-open"], {}).openBrowser, false);
});

test("supports truthy OMP_WEB_NO_OPEN values", () => {
  for (const value of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(parseLaunchOptions([], { OMP_WEB_NO_OPEN: value }).openBrowser, false);
  }
});

test("does not disable browser opening for false OMP_WEB_NO_OPEN values", () => {
  for (const value of ["0", "false", "off", ""]) {
    assert.equal(parseLaunchOptions([], { OMP_WEB_NO_OPEN: value }).openBrowser, true);
  }
});

test("preserves port and hostname options", () => {
  const parsed = parseLaunchOptions(["-p", "8080", "-H", "0.0.0.0"], {});
  assert.equal(parsed.port, "8080");
  assert.equal(parsed.hostname, "0.0.0.0");
  assert.equal(parsed.openBrowser, true);
});

test("supports OMP_WEB_HOSTNAME without trusting the ambient system HOSTNAME", () => {
  assert.equal(
    parseLaunchOptions([], { HOSTNAME: "container-id" }).hostname,
    "127.0.0.1",
  );
  assert.equal(
    parseLaunchOptions([], { OMP_WEB_HOSTNAME: "0.0.0.0" }).hostname,
    "0.0.0.0",
  );
});

test("supports --password and OMP_WEB_PASSWORD", () => {
  assert.equal(parseLaunchOptions([], {}).password, undefined);
  assert.equal(parseLaunchOptions([], { OMP_WEB_PASSWORD: "secret" }).password, "secret");
  assert.equal(parseLaunchOptions(["--password", "from-cli"], { OMP_WEB_PASSWORD: "from-env" }).password, "from-cli");
  assert.equal(parseLaunchOptions(["--password", "from-cli"], {}).password, "from-cli");
});
