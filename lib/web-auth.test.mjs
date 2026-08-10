import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { isValidBasicAuthorization, isWebPasswordEnabled, OMP_WEB_AUTH_USERNAME } = await jiti.import("./web-auth.ts");

test("accepts only the configured Basic Auth credentials", () => {
  const header = `Basic ${Buffer.from(`${OMP_WEB_AUTH_USERNAME}:secret`).toString("base64")}`;
  assert.equal(isWebPasswordEnabled("secret"), true);
  assert.equal(isValidBasicAuthorization(header, "secret"), true);
  assert.equal(isValidBasicAuthorization(header, "wrong"), false);
  assert.equal(isValidBasicAuthorization("Basic malformed", "secret"), false);
});
