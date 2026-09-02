// Route 1 (doc 16): the client adapter contract — React chooses the
// transport by kind through the single factory; unlanded kinds fail closed
// with a deterministic error naming the pending route.
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { AdapterUnavailableError, createOmpwebClient } = await jiti.import("./client/adapters.ts");

test("route 1: legacy-http kind returns the full client surface", () => {
  const client = createOmpwebClient("legacy-http");
  assert.equal(typeof client.agent.sendCommand, "function");
  assert.equal(typeof client.agent.subscribeSessionEvents, "function");
  assert.equal(typeof client.agent.subscribeRunningSessions, "function");
  assert.equal(typeof client.sessions.list, "function");
  assert.equal(typeof client.sessions.getContext, "function");
  assert.equal(typeof client.sessions.rename, "function");
  assert.equal(typeof client.sessions.archive, "function");
  assert.equal(typeof client.sessions.delete, "function");
  assert.equal(typeof client.system.subscribeSessionsChanged, "function");
});

test("route 1: tauri-core kind fails closed until route 18 lands", () => {
  assert.throws(() => createOmpwebClient("tauri-core"), (error) => {
    assert.ok(error instanceof AdapterUnavailableError);
    assert.equal(error.code, "client_runtime_unavailable");
    assert.match(error.message, /路线 18/);
    return true;
  });
});

test("route 1: remote kind fails closed until routes 14/20 land", () => {
  assert.throws(() => createOmpwebClient("remote"), (error) => {
    assert.ok(error instanceof AdapterUnavailableError);
    assert.equal(error.code, "client_runtime_unavailable");
    assert.match(error.message, /路线 14\/20/);
    return true;
  });
});


test("route 1: git adapter hits the expected routes with faithful payload mapping", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/api/github/status")) {
      return new Response(JSON.stringify({ repo: { owner: "o", repo: "r", url: "u", git: { branch: "main" } }, error: undefined }));
    }
    if (String(url).includes("/api/git/commit")) {
      return new Response(JSON.stringify({ hash: "abc123" }));
    }
    if (String(url).includes("/api/git/push")) {
      return new Response(JSON.stringify({ branch: "main" }));
    }
    return new Response(JSON.stringify({}), { status: 404 });
  };
  try {
    const { createHttpSseClient } = await jiti.import("./client/http-sse-adapter.ts");
    const git = createHttpSseClient().git;
    const status = await git.status("/work/dir", { refresh: true });
    assert.equal(status.repo.git.branch, "main");
    assert.equal(calls[0].url, "/api/github/status?cwd=%2Fwork%2Fdir&refresh=1");
    assert.equal(calls[0].init.cache, "no-store");
    const commit = await git.commit("/work/dir", "msg");
    assert.equal(commit.hash, "abc123");
    const parsedCommitBody = JSON.parse(calls[1].init.body);
    assert.deepEqual(parsedCommitBody, { cwd: "/work/dir", message: "msg" });
    const push = await git.push("/work/dir");
    assert.equal(push.branch, "main");
    assert.equal(JSON.parse(calls[2].init.body).cwd, "/work/dir");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("route 1: git adapter surfaces route errors as ClientError with the server message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/api/git/push")) {
      return new Response(JSON.stringify({ error: "upstream refused" }), { status: 500 });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  };
  try {
    const { createHttpSseClient } = await jiti.import("./client/http-sse-adapter.ts");
    await assert.rejects(createHttpSseClient().git.push("/work/dir"), (error) => {
      assert.equal(error.code, "http_500");
      assert.equal(error.message, "upstream refused");
      assert.equal(error.retryable, true);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("route 1: fixture git adapter serves scripted status and mutation failures", async () => {
  const { createFixtureClient } = await jiti.import("./client/fixture-adapter.ts");
  const { client, fixtures } = createFixtureClient();
  fixtures.setGitStatus({ repo: { owner: "o", repo: "r", url: "u" } });
  const status = await client.git.status("/x");
  assert.equal(status.repo.repo, "r");
  const empty = await client.git.status("/x");
  assert.equal(empty.repo, null);
  fixtures.failNextGit(new Error("boom"));
  await assert.rejects(client.git.commit("/x", "m"), /boom/);
  assert.equal((await client.git.commit("/x", "m")).hash, "fixture-hash");
});
