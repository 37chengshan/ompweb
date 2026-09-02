// Backend Ownership Manifest audit (doc 15 / v4 PR-C02).
//
//   node scripts/audit-backend-ownership.mjs [--check]
//
// Validates backend-ownership.yaml:
//   1. All 9 domains present, authority ∈ {node, rust}, evidence paths exist.
//   2. Every evidence path must reference the file that actually holds the
//      authority (existence + the file is under the production tree).
//   3. --check mode (used by npm test): fails with exit 1 on any drift.
// Future gates (as domains migrate to rust): a rust domain must not have a
// production Node authority implementation; scan keys are registered per
// domain so the check stays meaningful.
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "backend-ownership.yaml");
const REQUIRED_DOMAINS = ["agent", "event", "session", "pty", "files", "git", "settings", "commands", "remote"];

// Authority markers: when a domain flips to rust, these production Node
// implementations must be gone (or adapter-only). Keyed by domain.
const RUST_GATE_SCANS = {
  agent: ["spawn(", "rpc-manager"],
  event: ["EventSource", "session-change-bus"],
  session: ["buildSessionContext", "listAllSessions"],
  pty: ["node-pty", "terminal-shell"],
  files: ["app/api/files"],
  git: ["app/api/git", "worktree"],
  settings: ["settings-service", "omp-settings"],
  commands: ["toSlashCommandInfo", "scripts/run"],
  remote: ["remote-pairing", "pair/"],
};

export function loadManifest() {
  const raw = readFileSync(manifestPath, "utf8");
  const doc = YAML.parse(raw);
  if (!doc || !doc.domains || typeof doc.domains !== "object") {
    throw new Error("backend-ownership.yaml: missing domains map");
  }
  return { doc, raw };
}

export function auditManifest({ manifest = loadManifest(), productionRoot = root } = {}) {
  const { doc } = manifest;
  const problems = [];

  for (const domain of REQUIRED_DOMAINS) {
    const entry = doc.domains[domain];
    if (!entry) {
      problems.push(`${domain}: missing from manifest`);
      continue;
    }
    if (!["node", "rust"].includes(entry.authority)) {
      problems.push(`${domain}: invalid authority "${entry.authority}"`);
    }
    const evidence = Array.isArray(entry.evidence) ? entry.evidence : [entry.evidence];
    for (const ev of evidence) {
      // Evidence may be a path or a glob-ish fragment; existence check only
      // for concrete file paths (may contain * for route groups).
      if (ev.includes("*")) continue;
      const candidate = resolve(productionRoot, ev);
      const dirCandidate = resolve(productionRoot, dirname(ev));
      const matched = existsSync(candidate)
        || (existsSync(dirCandidate) && readdirContains(dirCandidate, ev));
      if (!matched) {
        problems.push(`${domain}: evidence "${ev}" not found`);
      }
    }
    // rust domains must not have the production Node authority markers —
    // UNLESS the manifest declares an explicit fallback backend (No Hidden
    // Fallback: the rollback must be a visible switch, not silent).
    if (entry.authority === "rust" && entry.fallback !== "node") {
      const markers = RUST_GATE_SCANS[domain] ?? [];
      for (const marker of markers) {
        if (findMarker(productionRoot, marker)) {
          problems.push(`${domain}: rust authority but Node marker "${marker}" still present`);
        }
      }
    }
  }

  const extra = Object.keys(doc.domains).filter((d) => !REQUIRED_DOMAINS.includes(d));
  for (const d of extra) problems.push(`unexpected domain "${d}" in manifest`);

  return {
    ok: problems.length === 0,
    problems,
    domains: Object.fromEntries(REQUIRED_DOMAINS.map((d) => [d, doc.domains[d]?.authority ?? "missing"])),
  };
}

function readdirContains(dir, pathFragment) {
  try {
    const name = pathFragment.split("/").pop();
    return readdirSync(dir).includes(name);
  } catch {
    return false;
  }
}

function findMarker(rootDir, marker) {
  const dirs = ["app", "lib", "components", "hooks", "desktop", "bin", "scripts"];
  for (const dir of dirs) {
    if (walkContains(join(rootDir, dir), marker, 0)) return true;
  }
  return false;
}

function walkContains(dir, marker, depth) {
  if (depth > 3 || !existsSync(dir)) return false;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
      if (walkContains(full, marker, depth + 1)) return true;
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      try {
        if (readFileSync(full, "utf8").includes(marker)) return true;
      } catch {
        // unreadable file — skip
      }
    }
  }
  return false;
}

import { readdirSync } from "node:fs";

// ---------------------------------------------------------------------------
// Route boundary gate (doc 16 route 2): production API routes must not reach
// domain authorities directly — no OMP process construction, no node-pty, no
// host IPC bypass. Allowed exceptions are registered with the pending route
// that retires them (they flip to hard failures when that route lands).
// ---------------------------------------------------------------------------

const ROUTE_AUTHORITY_MARKERS = [
  {
    marker: "new RpcProcess(",
    description: "route 直接 spawn OMP（Node process authority）",
    pending: "doc16 路线 4（auth login 收口 Rust supervisor utility/login mode）",
  },
  {
    marker: "node-pty",
    description: "route 直接创建 PTY（Node pty authority）",
    pending: "doc16 路线 8",
  },
];

/** Files that may contain the markers above, with the reason (pending route). */
const ROUTE_ALLOWLIST = [
  {
    file: "app/api/auth/login/[provider]/route.ts",
    reasons: ["auth login 是交互式流（extension_ui_request 双向 UI），需要 supervisor utility/login 模式落地后才能收口 Rust —— doc16 路线 4"],
  },
];

/** Scan app/api route files for direct authority markers. */
export function auditRouteBoundary({ productionRoot = root } = {}) {
  const problems = [];
  const apiDir = join(productionRoot, "app", "api");
  const routeFiles = [];
  collectRouteFiles(apiDir, routeFiles);
  for (const file of routeFiles) {
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const rel = file.slice(productionRoot.length + 1);
    const allowlisted = ROUTE_ALLOWLIST.find((entry) => entry.file === rel);
    for (const { marker, description, pending } of ROUTE_AUTHORITY_MARKERS) {
      if (!text.includes(marker)) continue;
      if (allowlisted) {
        problems.push(`(allowlisted) ${rel}: contains "${marker}" — ${allowlisted.reasons.join("; ")}`);
        continue;
      }
      problems.push(`${rel}: contains "${marker}" — ${description}（禁止直接触达 Domain Authority；应经 HostClient/lib 边界。待 ${pending}）`);
    }
  }
  return {
    ok: problems.every((p) => p.startsWith("(allowlisted)")),
    problems,
  };
}

function collectRouteFiles(dir, out) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectRouteFiles(full, out);
    else if (entry.name === "route.ts") out.push(full);
  }
}

// CLI
const isCheck = process.argv.includes("--check");
if (process.argv[1] && process.argv[1].endsWith("audit-backend-ownership.mjs")) {
  const result = auditManifest();
  for (const p of result.problems) console.error("ownership: " + p);
  console.log(`ownership: ${Object.entries(result.domains).map(([d, a]) => `${d}=${a}`).join(" ")}`);
  if (isCheck && !result.ok) {
    console.error("ownership: FAIL");
    process.exit(1);
  }
  console.log(result.ok ? "ownership: OK" : "ownership: FAIL");
  if (!isCheck && !result.ok) process.exit(1);
}

// Route boundary gate (doc 16 route 2): separate line — allowlisted findings
// are informational until the pending route retires them.
const boundary = auditRouteBoundary();
for (const p of boundary.problems) {
  if (p.startsWith("(allowlisted)")) console.log("boundary: " + p);
  else console.error("boundary: " + p);
}
console.log(boundary.ok ? "boundary: OK" : "boundary: FAIL");
if (isCheck && !boundary.ok) {
  console.error("boundary: FAIL");
  process.exit(1);
}

export default auditManifest;
