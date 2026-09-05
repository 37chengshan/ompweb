// Windows npm users should not need the Visual C++ redistributable.
// An explicit target keeps CRT flags off host-side build scripts/macros.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = ["build", "--locked", "--manifest-path", join(root, "crates", "Cargo.toml"), "--bin", "ompweb-host"];
const env = { ...process.env };
let target;
if (process.platform === "win32") {
  target = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-pc-windows-msvc`;
  args.push("--target", target);
  // CARGO_ENCODED_RUSTFLAGS has precedence over RUSTFLAGS. Append the static
  // CRT setting so an inherited dynamic setting cannot affect packaging.
  const flags = env.CARGO_ENCODED_RUSTFLAGS?.split("\x1f") ?? env.RUSTFLAGS?.trim().split(/\s+/) ?? [];
  env.CARGO_ENCODED_RUSTFLAGS = [...flags, "-C", "target-feature=+crt-static"].filter(Boolean).join("\x1f");
}
const result = spawnSync("cargo", args, { cwd: root, env, stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
if (target) {
  // Keep the existing development/runtime/staging layout stable.
  const dir = join(root, "crates", "target", "debug");
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(root, "crates", "target", target, "debug", "ompweb-host.exe"), join(dir, "ompweb-host.exe"));
}
