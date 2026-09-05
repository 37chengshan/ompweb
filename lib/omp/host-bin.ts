/**
 * ompweb-host production binary resolution (doc 16 route 3).
 *
 * 正式运行时 binary resolution，替代单一「源码目录 / import.meta.url」推导：
 *
 *   explicit   — OMPWEB_HOST_BIN（headless/CLI 的显式安装路径；测试与 CI）
 *   packaged   — <exec>/../Resources/bin/ompweb-host（桌面应用资源布局；主进程
 *                注入 OMPWEB_HOST_BIN 走 explicit，这里保留 execPath 几何推导
 *                作为 ELECTRON_RUN_AS_NODE 等进程形态的兜底）
 *   workspace  — ① <repo>/crates/target/debug/ompweb-host（模块位置推导，开发/CI）
 *                ② <cwd>/crates/target/debug/ompweb-host（standalone server 以
 *                standalone 目录为 cwd 启动时，crates 随 trace 保留在产物内）
 *   none       — Rust host 不存在 → Runtime unavailable（明确报错；绝不静默
 *                回退 Node Authority —— OMPWEB_BACKEND=node 是唯一显式回滚）
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

export class RuntimeUnavailableError extends Error {
  readonly code = "runtime_unavailable";
  constructor(message: string) {
    super(message);
    this.name = "RuntimeUnavailableError";
  }
}

export type HostBinMode = "explicit" | "packaged" | "workspace" | "none";

export interface HostBinResolution {
  /** Resolved binary path; the closest candidate even when `exists` is false
   * (so error messages can name it). */
  path: string;
  mode: HostBinMode;
  exists: boolean;
}

export interface HostBinLookup {
  env?: Record<string, string | undefined>;
  /** process.execPath — packaged geometry derivation. */
  execPath?: string;
  /** Directory of the calling module — workspace derivation root. */
  moduleDir?: string;
  /** process.cwd() — standalone layout fallback. */
  cwd?: string;
  /** Test injection: target platform (win32 picks the .exe name). */
  platform?: NodeJS.Platform;
  /** Test injection: filesystem probe. */
  exists?: (path: string) => boolean;
}

/**
 * Resolve a source-module directory without making host startup depend on how
 * Next/Electron serializes `import.meta.url`.  In particular, the Windows
 * server bundle can expose a non-absolute `file:` URL; Node rejects that in
 * `fileURLToPath` before a request can reach the Rust host.  The executable
 * lookup already has an explicit env and cwd ladder, so falling back to cwd
 * preserves those supported layouts rather than turning a URL-shape detail
 * into a session-list 500.
 *
 * Kept injectable because URL conversion differs by host platform and the
 * failure branch is a packaging contract we need to cover in tests.
 */
export function resolveModuleDir(
  moduleUrl: string | undefined,
  fallbackDir = process.cwd(),
  toPath: (url: string | URL) => string = fileURLToPath,
): string {
  if (!moduleUrl || !moduleUrl.startsWith("file:")) return fallbackDir;
  try {
    const path = toPath(moduleUrl);
    return isAbsolute(path) ? dirname(path) : fallbackDir;
  } catch {
    return fallbackDir;
  }
}

export function hostExeName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "ompweb-host.exe" : "ompweb-host";
}

/** Runtime host binary resolution. Pure and injectable for tests. */
export function resolveHostBin(lookup: HostBinLookup = {}): HostBinResolution {
  const env = lookup.env ?? process.env;
  const platform = lookup.platform ?? process.platform;
  const fileExists = lookup.exists ?? existsSync;
  const exe = hostExeName(platform);

  // 1. Explicit installation path (headless/CLI packaging, tests, CI). An
  //    explicitly set path is authoritative: a missing file is an error the
  //    caller must surface, not a trigger to probe lower layers.
  const explicit = env.OMPWEB_HOST_BIN?.trim();
  if (explicit) {
    return { path: explicit, mode: "explicit", exists: fileExists(explicit) };
  }

  // 2. Packaged desktop geometry: <Contents>/MacOS/<app> → ../Resources/bin.
  const execPath = lookup.execPath ?? process.execPath;
  if (execPath) {
    const packaged = join(dirname(execPath), "..", "Resources", "bin", exe);
    if (fileExists(packaged)) return { path: packaged, mode: "packaged", exists: true };
  }

  // 3. npm/global-install vendor layout: <pkg>/vendor/ompweb-host/<platform>/<exe>
  //    The published npm package cannot ship cargo build output, so the
  //    release pipeline stages the current platform's Rust host binary into
  //    vendor/ompweb-host/<platform>/ before packing. moduleDir points at
  //    <pkg>/lib/omp (or <pkg>/.next/server/... in the bundled app), so climb
  //    to the package root and probe the vendor dir.
  const moduleDir = lookup.moduleDir;
  if (moduleDir) {
    // moduleDir = <pkg>/lib/omp -> package root is two levels up; for the
    // bundled server (moduleDir under .next) keep climbing until a
    // package.json / vendor marker is found (bounded to 5 levels).
    let probeDir = moduleDir;
    for (let depth = 0; depth < 5; depth += 1) {
      const vendorCandidate = join(probeDir, "vendor", "ompweb-host", process.platform, exe);
      if (fileExists(vendorCandidate)) {
        return { path: vendorCandidate, mode: "workspace", exists: true };
      }
      const parent = dirname(probeDir);
      if (parent === probeDir) break;
      probeDir = parent;
    }
  }

  // 4. Workspace layouts: repo crate output (dev/CI), or the standalone
  //    artifact rooted at the server's cwd (desktop/headless standalone).
  const cwd = lookup.cwd ?? process.cwd();
  const candidates: Array<{ dir: string; label: string }> = [];
  if (moduleDir) candidates.push({ dir: join(moduleDir, "..", ".."), label: "module" });
  if (cwd) candidates.push({ dir: cwd, label: "cwd" });
  for (const { dir } of candidates) {
    const candidate = join(dir, "crates", "target", "debug", exe);
    if (fileExists(candidate)) return { path: candidate, mode: "workspace", exists: true };
  }

  // 5. None: report the best (first) candidate so remediation messages can
  //    point at the expected location.
  const fallback = candidates.length > 0
    ? join(candidates[0].dir, "crates", "target", "debug", exe)
    : exe;
  return { path: fallback, mode: "none", exists: false };
}

/** Actionable remediation for a missing host binary. */
export function hostBinRemediation(resolution: HostBinResolution): string {
  const lines = [
    `ompweb-host binary missing at ${resolution.path}`,
  ];
  if (resolution.mode === "explicit") {
    lines.push("OMPWEB_HOST_BIN points at a file that does not exist — fix the path or unset it for auto-resolution.");
  } else {
    lines.push('Build it: npm run host:build (cargo build --locked --manifest-path crates/Cargo.toml --bin ompweb-host)');
    lines.push("Or point OMPWEB_HOST_BIN at an installed ompweb-host binary.");
  }
  lines.push("Rust is the production backend: there is no silent fallback to the Node authority. Roll back explicitly with OMPWEB_BACKEND=node.");
  return lines.join("\n");
}

/** Throws RuntimeUnavailableError unless a usable host binary resolves. */
export function assertHostAvailable(lookup: HostBinLookup = {}): HostBinResolution {
  const resolution = resolveHostBin(lookup);
  if (!resolution.exists) {
    throw new RuntimeUnavailableError(hostBinRemediation(resolution));
  }
  return resolution;
}
