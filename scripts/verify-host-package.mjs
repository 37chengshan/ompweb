import { accessSync, constants, openSync, readSync, closeSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyWindowsHost } from "./lib/host-pe.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const targets = process.argv.includes("--current")
  ? [`${process.platform}-${process.arch}`]
  : ["linux-x64", "darwin-arm64", "darwin-x64", "win32-x64"];
for (const target of targets) {
  const exe = target.startsWith("win32-") ? "ompweb-host.exe" : "ompweb-host";
  const path = join(root, "vendor", "ompweb-host", target, exe);
  const stat = statSync(path);
  if (!stat.isFile() || stat.size < 1024) throw new Error(`Missing or invalid Rust host: ${target}`);
  if (!target.startsWith("win32-") && process.platform !== "win32") accessSync(path, constants.X_OK);
  const fd = openSync(path, "r");
  const header = Buffer.alloc(4);
  try { readSync(fd, header, 0, 4, 0); } finally { closeSync(fd); }
  const magic = header.toString("hex");
  const valid = target.startsWith("win32-") ? magic.startsWith("4d5a")
    : target.startsWith("linux-") ? magic === "7f454c46"
      : ["cffaedfe", "feedfacf", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"].includes(magic);
  if (!valid) throw new Error(`Wrong executable format: ${target}`);
  if (target.startsWith("win32-")) verifyWindowsHost(path);
}
console.log(`Rust package payload verified: ${targets.join(", ")}`);
