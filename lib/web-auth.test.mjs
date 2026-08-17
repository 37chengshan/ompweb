import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { NextRequest } = await import("next/server.js");
const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server.js");
const { createWebSession, isValidWebPassword, isValidWebSession, isWebPasswordEnabled } = await jiti.import("./web-auth.ts");
const { config, proxy } = await jiti.import("../proxy.ts");

test("accepts the configured password and validates signed sessions", () => {
  assert.equal(isWebPasswordEnabled("secret"), true);
  assert.equal(isValidWebPassword("secret", "secret"), true);
  assert.equal(isValidWebPassword("wrong", "secret"), false);

  const now = 1_700_000_000_000;
  const session = createWebSession("secret", now);
  assert.equal(isValidWebSession(session, "secret", now), true);
  assert.equal(isValidWebSession(session, "changed", now), false);
  assert.equal(isValidWebSession(session, "secret", now + 31 * 24 * 60 * 60 * 1000), false);
});

test("redirects browser requests to the password screen and blocks unauthenticated APIs", () => {
  const previousPassword = process.env.OMP_WEB_PASSWORD;
  process.env.OMP_WEB_PASSWORD = "secret";
  try {
    const pageResponse = proxy(new NextRequest("http://localhost:30177/"));
    assert.equal(pageResponse.status, 307);
    assert.equal(pageResponse.headers.get("location"), "http://localhost:30177/login");

    const apiResponse = proxy(new NextRequest("http://localhost:30177/api/sessions"));
    assert.equal(apiResponse.status, 401);

    const session = createWebSession("secret");
    const signedInResponse = proxy(new NextRequest("http://localhost:30177/", {
      headers: { cookie: `omp_web_session=${session}` },
    }));
    assert.equal(signedInResponse.status, 200);
  } finally {
    if (previousPassword === undefined) delete process.env.OMP_WEB_PASSWORD;
    else process.env.OMP_WEB_PASSWORD = previousPassword;
  }
});

test("leaves Next.js build assets outside password protection", () => {
  assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/_next/static/chunks/app.js" }), false);
  assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/api/sessions" }), true);
});
