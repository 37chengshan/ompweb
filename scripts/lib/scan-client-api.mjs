// Shared scanner for direct client-side API calls (5.0 plan W0, doc 01 Slice 1).
//
// One detection implementation, three consumers:
//   - scripts/audit-client-api.mjs      → committed inventory + allowlist generator
//   - eslint.config.mjs (own copy)      → lint-time regression gate
//   - lib/api-inventory.test.mjs        → committed inventory / allowlist stay in sync
//
// Detection covers exactly what the 5.0 client boundary work will migrate:
//   1. fetch("/api...") / fetch(`/api...`)          — direct HTTP
//   2. fetch(someApiUrl(...))                        — indirect via *ApiUrl helpers
//   3. new EventSource(...)                          — SSE subscriptions
//
// Scoped to UI code roots (app excluding app/api, components, hooks, lib);
// .test.mjs files and scripts/ are out of scope.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const UI_ROOTS = ["app", "components", "hooks", "lib"];
const EXCLUDED_SEGMENTS = new Set(["node_modules", "api", "scripts"]);
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mts"]);

export const REPO_ROOT_DIR = REPO_ROOT;

function listFiles(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (EXCLUDED_SEGMENTS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listFiles(full, out);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

/** Template literal source → `/api/agent/{param}/events` style endpoint. */
function normalizeTemplate(quasis) {
  return quasis
    .map((q, i) => (i === 0 ? q.value.cooked : `{param}${q.value.cooked}`))
    .join("");
}

function endpointFromSource(source) {
  const trimmed = source.trim();
  if (/^["'`]/.test(trimmed)) {
    const stripped = trimmed.replace(/^["'`]|["'`]$/g, "");
    return stripped.replace(/\$\{[^}]*\}/g, "{param}").split("?")[0];
  }
  const ident = /^([\w$.]+)/.exec(trimmed);
  return ident ? `helper:${ident[1]}` : "dynamic";
}

function domainOf(endpoint) {
  if (endpoint.startsWith("helper:")) return "files";
  const segments = endpoint.replace(/^\/api\/?/, "").split("/");
  return segments[0] || "root";
}

function methodAfterFetch(content, callStart) {
  const window = content.slice(callStart, callStart + 700);
  const match = /method:\s*["'](GET|POST|PUT|PATCH|DELETE)["']/.exec(window);
  return match ? match[1] : "GET";
}

function classify(kind, method) {
  if (kind === "sse") return { rw: "read", stream: true };
  return { rw: method === "GET" ? "read" : "write", stream: false };
}

/** Extract endpoint source text for a call whose args start at `argsIndex`. */
function firstArgSource(content, argsIndex) {
  let depth = 0;
  let i = argsIndex;
  let quote = null;
  while (i < content.length) {
    const ch = content[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) break;
      depth--;
    } else if (ch === "," && depth === 0) {
      break;
    }
    i++;
  }
  return content.slice(argsIndex, i);
}

/** Scan one file and return call records. */
export function scanSource(content) {
  const records = [];
  const seen = new Set();

  const push = (kind, index, endpointSource) => {
    const key = `${kind}:${index}`;
    if (seen.has(key)) return;
    seen.add(key);
    const endpoint = endpointFromSource(endpointSource);
    const method = kind === "sse" ? "GET" : methodAfterFetch(content, index);
    const { rw, stream } = classify(kind, method);
    records.push({
      line: lineOf(content, index),
      kind,
      method,
      endpoint,
      domain: domainOf(endpoint),
      rw,
      stream,
    });
  };

  // fetch with literal or template starting /api
  const fetchRegex = /\bfetch\(\s*/g;
  let match;
  while ((match = fetchRegex.exec(content))) {
    const argStart = match.index + match[0].length;
    const arg = firstArgSource(content, argStart).trim();
    const literal = /^(["'])\/api/.exec(arg);
    const template = /^`[\s\S]*`$/.test(arg);
    // Mirror the eslint rule: any template segment starting with /api counts,
    // so `${base}/api/x` dynamic-prefix bypasses are registered too.
    const templateApi =
      template && arg.slice(1, -1).split(/\$\{[^}]*\}/).some((s) => s.trimStart().startsWith("/api"));
    const helper = /^(\w*ApiUrl)\s*\(/.exec(arg);
    if (literal || templateApi || helper) {
      push("http", match.index, arg);
    }
  }

  // EventSource subscriptions
  const esRegex = /\bnew\s+EventSource\s*\(\s*/g;
  while ((match = esRegex.exec(content))) {
    push("sse", match.index, firstArgSource(content, match.index + match[0].length));
  }

  records.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
  return records;
}

/** Scan the whole repo; returns [{ file, calls }] sorted by path. */
export function scanRepo() {
  const files = [];
  for (const root of UI_ROOTS) {
    listFiles(path.join(REPO_ROOT, root), files);
  }
  files.sort();
  const out = [];
  for (const file of files) {
    const records = scanSource(readFileSync(file, "utf8"));
    if (records.length > 0) {
      out.push({
        file: path.relative(REPO_ROOT, file).replaceAll(path.sep, "/"),
        calls: records,
      });
    }
  }
  return out;
}

export function totalsOf(scanned) {
  const totals = { files: scanned.length, calls: 0, http: 0, sse: 0, read: 0, write: 0 };
  const domains = {};
  for (const { calls } of scanned) {
    for (const call of calls) {
      totals.calls++;
      totals[call.kind]++;
      totals[call.rw]++;
      domains[call.domain] = (domains[call.domain] ?? 0) + 1;
    }
  }
  return { totals, domains };
}
