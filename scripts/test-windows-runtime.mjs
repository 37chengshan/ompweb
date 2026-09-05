// Integration tests against the real Windows host. All ACLs, locks and shares
// belong to disposable fixtures; no machine policy or user configuration edits.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createConnection } from "node:net";
import { createInterface } from "node:readline";

if (process.platform !== "win32") throw new Error("Requires a real Windows runner");
const evidence = { platform: process.platform, arch: process.arch, node: process.version, cases: [] };
const dir = mkdtempSync(join(tmpdir(), "ompweb-windows-"));
const allowed = join(dir, "测试 workspace");
const outside = join(dir, "outside");
mkdirSync(allowed); mkdirSync(outside);
const long = join(allowed, ...Array.from({ length: 7 }, (_, i) => `segment-${i}-${"x".repeat(38)}`));
mkdirSync(long, { recursive: true });
const psArgs = (code) => ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(code, "utf16le").toString("base64")];
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const psEnv = { ...process.env };
delete psEnv.PSModulePath; // A pwsh runner must not force PS7 modules into Windows PowerShell 5.1.
const ps = (code) => {
  const result = spawnSync("powershell.exe", psArgs(`$ErrorActionPreference='Stop'; ${code}`), { encoding: "utf8", timeout: 15000, windowsHide: true, env: psEnv });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr);
  return result.stdout.trim();
};
evidence.identity = JSON.parse(ps("$i=[Security.Principal.WindowsIdentity]::GetCurrent(); @{sid=$i.User.Value; administrator=([Security.Principal.WindowsPrincipal]::new($i)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)} | ConvertTo-Json -Compress"));
const binary = resolve(process.argv[2] ?? "crates/target/debug/ompweb-host.exe");
let child, socket, share;
const pending = new Map();
let seq = 0;
const request = (method, params) => new Promise((resolveRequest, reject) => {
  const id = String(++seq);
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 12000);
  pending.set(id, (reply) => { clearTimeout(timer); resolveRequest(reply); });
  socket.write(JSON.stringify({ id, method, params }) + "\n");
});
const ok = async (method, params) => {
  const reply = await request(method, params);
  assert.equal(reply.ok, true, JSON.stringify(reply.error));
  return reply.result;
};
const check = async (name, run) => {
  const start = Date.now();
  try { const details = await run(); evidence.cases.push({ name, status: "pass", ms: Date.now() - start, details }); }
  catch (error) { evidence.cases.push({ name, status: "fail", ms: Date.now() - start, error: String(error) }); }
  console.log(`${evidence.cases.at(-1).status}: ${name}`);
};
const sessionFile = (file) => {
  const title = JSON.stringify({ type: "title", v: 1, title: "fixture" });
  writeFileSync(file, title + " ".repeat(255 - Buffer.byteLength(title)) + "\n" + JSON.stringify({ type: "session", version: 3, id: "fixture", cwd: allowed }) + "\n");
};
try {
  const health = spawnSync(binary, ["--health"], { encoding: "utf8", timeout: 5000 });
  assert.equal(health.status, 0, health.stderr);
  // Startup itself exercises a >260-character SQLite path.
  child = spawn(binary, ["--ipc"], { cwd: allowed, env: { ...process.env, OMPWEB_RUNTIME_DB: join(long, "runtime.db"), OMP_WEB_REMOTE_BIND: "127.0.0.1:0" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  const boot = createInterface({ input: child.stdout });
  let booted = false;
  const [line] = await Promise.race([once(boot, "line"), once(child, "exit").then(() => { if (booted) return; evidence.cases.push({ name: "long-path SQLite startup", status: "fail", error: stderr }); throw new Error(`host exited during startup: ${stderr}`); }), new Promise((_, reject) => setTimeout(() => reject(new Error("host startup timed out")), 12000).unref())]);
  booted = true;
  const info = JSON.parse(line);
  socket = createConnection({ host: "127.0.0.1", port: info.port });
  await once(socket, "connect");
  createInterface({ input: socket }).on("line", (value) => { const reply = JSON.parse(value); const done = pending.get(reply.id); if (done) { pending.delete(reply.id); done(reply); } });
  await ok("hello", { token: info.token });
  await check("long-path SQLite startup and IPC", () => ok("ping", {}));
  const sample = join(long, "文件 sample.txt"); writeFileSync(sample, "file-marker");
  for (const [name, path, roots] of [
    ["long Unicode path", sample, [allowed]],
    ["case and slash variants", sample.toUpperCase().replaceAll("\\", "/"), [allowed]],
    ["extended path namespace", `\\\\?\\${sample}`, [allowed]],
    ["root with trailing separator", sample, [allowed + "\\"]],
  ]) await check(name, async () => { assert.equal((await ok("files.read", { path, roots })).content, "file-marker"); return { pathLength: path.length }; });
  const junction = join(allowed, "junction"); symlinkSync(outside, junction, "junction");
  const outsideFile = join(outside, "session.jsonl"); sessionFile(outsideFile);
  await check("junction read cannot escape root", async () => assert.equal((await request("files.read", { path: join(junction, "session.jsonl"), roots: [allowed] })).ok, false));
  await check("junction session mutation cannot escape root", async () => {
    const before = readFileSync(outsideFile, "utf8");
    assert.equal((await request("session.rename", { root: allowed, path: join(junction, "session.jsonl"), title: "escaped" })).ok, false);
    assert.equal(readFileSync(outsideFile, "utf8"), before);
  });
  const session = join(allowed, "session.jsonl"); sessionFile(session);
  await check("session rename with trailing root separator", () => ok("session.rename", { root: allowed + "\\", path: session, title: "renamed" }));
  await check("exclusive file lock fails promptly then recovers", async () => {
    const locker = spawn("powershell.exe", psArgs(`$f=[IO.File]::Open(${literal(session)},'Open','ReadWrite','None'); Write-Output 'locked'; [Console]::ReadLine() | Out-Null; $f.Dispose()`), { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const lines = createInterface({ input: locker.stdout });
    const exited = once(locker, "exit");
    try {
      await once(lines, "line");
      assert.equal((await request("session.delete", { root: allowed, path: session })).ok, false);
      await ok("ping", {});
    } finally { locker.stdin.end("release\n"); await exited; }
    await ok("session.rename", { root: allowed, path: session, title: "unlocked" });
    await ok("session.delete", { root: allowed, path: session });
  });
  await check("explicit read ACL denial and recovery", async () => {
    const file = join(allowed, "acl.txt"); writeFileSync(file, "acl-marker");
    try {
      ps(`$acl=Get-Acl -LiteralPath ${literal(file)}; $rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new(${literal(evidence.identity.sid)}),'ReadData','Deny'); $acl.AddAccessRule($rule); Set-Acl -LiteralPath ${literal(file)} -AclObject $acl`);
      assert.equal((await request("files.read", { path: file, roots: [allowed] })).ok, false);
    } finally { ps(`$acl=Get-Acl -LiteralPath ${literal(file)}; $acl.Access | Where-Object {$_.AccessControlType -eq 'Deny'} | ForEach-Object { $acl.RemoveAccessRule($_) | Out-Null }; Set-Acl -LiteralPath ${literal(file)} -AclObject $acl`); }
    assert.equal((await ok("files.read", { path: file, roots: [allowed] })).content, "acl-marker");
  });
  const commandCwd = async (cwd) => {
    writeFileSync(join(cwd, "cwd-marker.txt"), "correct-workspace");
    const result = await ok("commands.run", { roots: [cwd], cwd, command: "type cwd-marker.txt", detach: false });
    assert.equal(result.exitCode, 0, result.output);
    assert.ok(result.output.includes("correct-workspace"), result.output);
  };
  const ptyCwd = async (cwd) => {
    const {id} = await ok("pty.spawn", {cwd, roots:[cwd], cols:80, rows:24});
    const file = join(cwd, `pty-${process.pid}.txt`);
    try {
      await ok("pty.write", {id, data:`echo terminal-marker>pty-${process.pid}.txt\r`});
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        try { if (readFileSync(file, "utf8").includes("terminal-marker")) return; } catch { /* shell starting */ }
        await new Promise((done) => setTimeout(done, 50));
      }
      assert.fail("Terminal did not write inside the requested workspace");
    } finally { await ok("pty.kill", {id}); }
  };
  await check("PTY Unicode cwd", () => ptyCwd(allowed));
  await check("PTY long cwd", () => ptyCwd(long));
  await check("command Unicode cwd", () => commandCwd(allowed));
  await check("command long cwd never falls back", () => commandCwd(long));
  await check("UNC file and command cwd", async () => {
    share = `ompweb-qa-${process.pid}`;
    ps(`New-SmbShare -Name ${literal(share)} -Path ${literal(allowed)} -FullAccess ([Security.Principal.WindowsIdentity]::GetCurrent().Name) | Out-Null`);
    const unc = `\\\\localhost\\${share}`;
    assert.equal((await ok("files.read", { path: join(unc, "cwd-marker.txt"), roots: [unc] })).content, "correct-workspace");
    await commandCwd(unc);
    await ptyCwd(unc);
  });
} finally {
  socket?.destroy();
  if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
  if (share) ps(`Remove-SmbShare -Name ${literal(share)} -Force -ErrorAction SilentlyContinue`);
  writeFileSync("windows-runtime-evidence.json", JSON.stringify(evidence, null, 2) + "\n");
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
if (evidence.cases.some((item) => item.status !== "pass")) process.exitCode = 1;
