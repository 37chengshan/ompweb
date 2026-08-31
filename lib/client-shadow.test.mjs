import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { generateSessionJsonl, sessionFileName } from "../scripts/lib/session-fixture-gen.mjs";

// 5.0 doc 01 Slice 2 — dual-read shadow verification: the legacy route path
// and the lib/client facade must produce IDENTICAL snapshots (canonical-json
// sha256) over the same fixture, and mutations must stay single-write through
// the legacy PATCH route.

const repoRoot = path.resolve(import.meta.dirname, "..");
const agentDir = mkdtempSync(path.join(tmpdir(), "ompweb-shadow-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
process.on("exit", () => {
  try {
    rmSync(agentDir, { recursive: true, force: true });
  } catch {}
});

const jiti = createJiti(import.meta.url, {
  // Route handlers import via the "@/..." alias — teach the test loader the
  // same mapping tsconfig uses.
  alias: { "@": repoRoot },
});
const { createHttpSseClient } = await jiti.import("./client/http-sse-adapter.ts");
const { cacheSessionPath, invalidateSessionListCache, readSessionHeader } = await jiti.import("./session-reader.ts");

// Fixture session on disk (chat mix incl. toolCalls + image metadata).
const { jsonl, sessionId } = generateSessionJsonl({
  messageCount: 60,
  seed: 7,
  cwd: agentDir,
  title: "shadow fixture",
});
const slug = "shadow-project";
const sessionsDir = path.join(agentDir, "sessions", slug);
mkdirSync(sessionsDir, { recursive: true });
const filePath = path.join(sessionsDir, sessionFileName(7));
writeFileSync(filePath, jsonl);
cacheSessionPath(sessionId, filePath);

// Route handlers (the legacy path), imported directly — no Next server.
const contextRoute = await jiti.import("../app/api/sessions/[id]/context/route.ts");
const sessionRoute = await jiti.import("../app/api/sessions/[id]/route.ts");
const listRoute = await jiti.import("../app/api/sessions/route.ts");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}
const hash = (v) => createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");

/** Route-dispatching fetch stub: the facade talks to the REAL handlers. */
async function stubFetch(url, init) {
  const abs = url.startsWith("http") ? url : `http://local.test${url}`;
  const req = new Request(abs, init);
  const route = new URL(abs).pathname;
  const id = decodeURIComponent(route.split("/")[3] ?? "");
  if (route === "/api/sessions") {
    return listRoute.GET(req);
  }
  if (route === `/api/sessions/${id}/context`) {
    return contextRoute.GET(req, { params: Promise.resolve({ id }) });
  }
  if (route === `/api/sessions/${id}` && init?.method === "PATCH") {
    return sessionRoute.PATCH(req, { params: Promise.resolve({ id }) });
  }
  throw new Error(`stubFetch: unmapped ${init?.method ?? "GET"} ${route}`);
}

test("dual-read shadow: context snapshot hash identical on legacy route vs facade", async () => {
  invalidateSessionListCache();

  // Legacy read (route handler, as the 4.x UI consumes it).
  const legacyReq = new Request(`http://local.test/api/sessions/${sessionId}/context`, { headers: { "x-legacy": "1" } });
  const legacyRes = await contextRoute.GET(legacyReq, { params: Promise.resolve({ id: sessionId }) });
  const legacyBody = await legacyRes.json();
  console.error("DBG legacy status:", legacyRes.status, "keys:", Object.keys(legacyBody), legacyBody.error ?? "");
  const legacyContext = legacyBody.context;

  // Facade read (same handlers via the adapter's fetch, as 5.0 consumes it).
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stubFetch;
  try {
    const client = createHttpSseClient();
    const facadeContext = await client.sessions.getContext(sessionId);

    assert.equal(hash(legacyContext), hash(facadeContext), "context snapshot hash diverged between legacy route read and facade read");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dual-read shadow: session list snapshot hash identical, facade maps the raw body", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stubFetch;
  try {
    const legacyRes = await listRoute.GET(new Request("http://local.test/api/sessions"));
    const legacyBody = await legacyRes.json();

    const client = createHttpSseClient();
    const facadeList = await client.sessions.list();

    assert.equal(
      hash(legacyBody.sessions),
      hash(facadeList),
      "session list hash diverged between legacy route read and facade read",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("single-write: facade rename goes through the legacy PATCH route exactly once", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    return stubFetch(url, init);
  };
  try {
    const client = createHttpSseClient();
    await client.sessions.rename(sessionId, "renamed-via-facade");
    assert.equal(calls.length, 1, "a rename must be exactly one write through one path");
    assert.equal(calls[0].method, "PATCH");
    const header = readSessionHeader(filePath);
    if (header?.title !== "renamed-via-facade") {
      const fs = await import("node:fs");
      console.error("DBG header:", JSON.stringify(header)?.slice(0, 200));
      console.error("DBG slot head:", JSON.stringify(fs.readFileSync(filePath).slice(0, 260)));
      console.error("DBG filePath:", filePath);
    }
    assert.equal(header?.title, "renamed-via-facade");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
