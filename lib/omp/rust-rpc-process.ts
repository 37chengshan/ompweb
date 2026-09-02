/**
 * Rust OMP supervisor adapter (doc 15 R8.4 — production cutover).
 *
 * A drop-in replacement for RpcProcess that talks to `ompweb-host --ipc`
 * instead of spawning `omp --mode rpc-ui` directly: the OMP child lifecycle
 * belongs to the Rust supervisor (spawn/kill/restart), and this class only
 * routes commands + frames over the local IPC.
 *
 * One host process serves every session (RustHostManager singleton); each
 * session gets its own attach connection for the frame stream, while
 * request/response commands share the manager's control connection.
 *
 * Rust is the default backend. Node path (RpcProcess) remains the explicit
 * rollback via OMPWEB_BACKEND=node.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertHostAvailable, resolveHostBin } from "./host-bin";
import { RpcFrameDecoder, type RpcFrameRecord, type RpcProtocolVersion } from "./rpc-frame";
import { RpcCommandError } from "./rpc-process";
import type { RpcProcessOptions } from "./rpc-process";

/**
 * Directory of this module — the workspace resolution root (dev/CI cargo
 * output). Packaged desktop injects OMPWEB_HOST_BIN from the Electron main
 * process (Resources/bin); standalone servers additionally resolve via their
 * cwd. Full ladder in host-bin.ts (doc 16 route 3).
 */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const READY_TIMEOUT_MS = 30_000;

/** Resolved host binary (env explicit → packaged → workspace ladder). */
function hostBinaryPath(): string {
  return resolveHostBin({ moduleDir: MODULE_DIR }).path;
}

/**
 * Rust hosts are intentionally detached from the Node event loop, but a
 * crashed standalone server can leave an idle host behind. Those orphan
 * hosts keep the runtime journal open and make a later resume look like a
 * second omp instance. Only hosts reparented to launchd/init are eligible;
 * the host owned by the current server is never touched.
 */
export function cleanupOrphanRustHosts(options: { dryRun?: boolean } = {}): { stopped: number; pids: number[] } {
  if (process.platform === "win32") return { stopped: 0, pids: [] };
  let listing = "";
  try {
    listing = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", timeout: 3000 });
  } catch {
    return { stopped: 0, pids: [] };
  }
  const hostBin = hostBinaryPath();
  const pids: number[] = [];
  for (const line of listing.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const command = match[3].trim();
    if (!Number.isInteger(pid) || pid <= 0 || ppid !== 1 || pid === process.pid) continue;
    if (command !== `${hostBin} --ipc` && command !== `${hostBin} --ipc `) continue;
    if (options.dryRun) {
      pids.push(pid);
      continue;
    }
    try {
      process.kill(pid, "SIGTERM");
      pids.push(pid);
    } catch {
      // A race with launchd/process exit is already a successful cleanup.
    }
  }
  return { stopped: pids.length, pids };
}

/** Inspect reparented OmpWeb hosts without terminating anything. */
export function listOrphanRustHosts(): number[] {
  return cleanupOrphanRustHosts({ dryRun: true }).pids;
}

export interface RustRpcProcessOptions {
  cwd: string;
  sessionId: string;
  extraArgs?: string[];
  onExit?: (info: { stderrTail: string }) => void;
  env?: Record<string, string>;
}

interface PendingCommand {
  type: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** Frame handler signature compatible with RpcProcess.onFrame. */
export type RpcFrameHandler = (frame: RpcFrameRecord) => void;

class RustHostManager {
  private host: ChildProcess | null = null;
  private hostDying = false;
  private teardownTimer: ReturnType<typeof setTimeout> | null = null;
  private port = 0;
  private token = "";
  private bootBuffer = "";
  private bootPromise: Promise<void> | null = null;
  private control: Socket | null = null;
  private controlBuffer = "";
  private pending = new Map<string, PendingCommand>();
  private nextId = 1;
  private subscribers = new Set<RpcFrameHandler>();
  private refs = 0;

  cleanupOrphans(): { stopped: number; pids: number[] } {
    return cleanupOrphanRustHosts();
  }

  acquire(): void {
    this.refs += 1;
    // A new consumer cancels the pending idle teardown: frequent session
    // switches reuse the same host instead of racing process shutdowns.
    if (this.teardownTimer) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }
  }

  release(): void {
    this.refs -= 1;
    if (this.refs <= 0 && !this.teardownTimer) {
      // Idle grace: keep the host warm across rapid session churn; tear it
      // down only after sustained inactivity.
      this.teardownTimer = setTimeout(() => {
        this.teardownTimer = null;
        this.teardown();
      }, 30_000);
      this.teardownTimer.unref?.();
    }
  }

  private teardown(): void {
    // Sessions are killed by each RustRpcProcess.dispose() before release;
    // killing the host here only terminates the supervisor itself. The host
    // reference stays until the exit event so the next ensure() can await
    // the process tree (agent.db lock) before booting a replacement.
    this.control?.destroy();
    this.control = null;
    this.host?.kill();
    this.hostDying = true;
    this.bootPromise = null;
    this.pending.clear();
  }

  /** Explicit full shutdown: teardown + wait for the process tree exit. */
  async shutdown(): Promise<void> {
    const host = this.host;
    this.teardown();
    if (host && host.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 3000);
        timer.unref?.();
        host.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  private async ensure(): Promise<void> {
    if (this.host && !this.hostDying && this.host.exitCode === null) return;
    if (this.bootPromise) return this.bootPromise;
    if (this.host) {
      // Old host still exiting: wait for its process tree (incl. omp
      // children) to release before the new host spawns.
      if (this.host.exitCode === null) {
        await new Promise<void>((resolve) => {
          this.host!.once("exit", () => resolve());
          setTimeout(resolve, 3000).unref?.();
        });
      }
      this.host = null;
    }
    // Fresh boot: drop any leftover boot line from the previous host — a
    // stale port/token here would connect to the dead process.
    this.bootBuffer = "";
    // Route 3 (doc 16): a missing host binary is Runtime unavailable, never
    // a silent Node fallback. Throws RuntimeUnavailableError with remediation.
    const hostResolution = assertHostAvailable({ moduleDir: MODULE_DIR });
    this.bootPromise = new Promise<void>((resolve, reject) => {
      const child = spawn(hostResolution.path, ["--ipc"], { stdio: ["ignore", "pipe", "inherit"] });
      // The host is a workhorse for this process: it must never keep the
      // process alive (tests, short-lived scripts). teardown() owns its
      // lifecycle while the process runs.
      child.unref();
      this.host = child;
      child.on("error", (err) => {
        this.bootPromise = null;
        reject(err);
      });
      child.on("exit", () => {
        // Frames listeners get a synthetic disconnect on host death; the
        // next acquire re-boots.
        for (const sub of this.subscribers) sub({ type: "host_disconnected" } as RpcFrameRecord);
        this.host = null;
        this.hostDying = false;
        this.control?.destroy();
        this.control = null;
      });
      const timer = setTimeout(() => {
        this.bootPromise = null;
        reject(new Error("ompweb-host boot timeout"));
      }, 5000);
      // The boot stream must not keep the process alive either; events still
      // fire normally while unref'd. Node's public Readable type does not
      // declare unref(), although pipe handles expose it on supported
      // runtimes, so retain a guarded optional call.
      (child.stdout as typeof child.stdout & { unref?: () => void }).unref?.();
      child.stdout.on("data", (chunk) => {
        this.bootBuffer += chunk.toString();
        const idx = this.bootBuffer.indexOf("\n");
        if (idx < 0) return;
        clearTimeout(timer);
        const line = this.bootBuffer.slice(0, idx).trim();
        try {
          const info = JSON.parse(line);
          this.port = info.port;
          this.token = info.token;
          this.bootPromise = null;
          resolve();
        } catch (err) {
          this.bootPromise = null;
          reject(new Error("bad host boot line: " + line));
        }
      });
    });
    return this.bootPromise;
  }

  async controlRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    await this.ensure();
    if (!this.control || this.control.destroyed) {
      this.control = createConnection({ host: "127.0.0.1", port: this.port });
      this.control.unref();
      this.control.on("data", (chunk: Buffer) => this.handleControlData(chunk));
      await new Promise<void>((resolve, reject) => {
        this.control!.once("connect", () => resolve());
        this.control!.once("error", reject);
      });
      await this.controlRequestRaw("hello", { token: this.token });
    }
    return this.controlRequestRaw(method, params);
  }

  private controlRequestRaw(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = `c${this.nextId++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { type: method, resolve, reject });
      this.control!.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  private handleControlData(chunk: Buffer): void {
    this.controlBuffer += chunk.toString();
    let idx: number;
    while ((idx = this.controlBuffer.indexOf("\n")) >= 0) {
      const line = this.controlBuffer.slice(0, idx).trim();
      this.controlBuffer = this.controlBuffer.slice(idx + 1);
      if (!line) continue;
      let msg: { id?: string; ok?: boolean; result?: unknown; error?: { code?: string; message?: string } };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof msg.id !== "string") continue;
      const entry = this.pending.get(msg.id);
      if (entry) {
        this.pending.delete(msg.id);
        if (msg.ok) entry.resolve(msg.result);
        else entry.reject(new RpcCommandError(entry.type, msg.error?.message ?? "rpc failed", msg.error?.code ?? "rpc_error"));
      }
    }
  }

  /** Register a global frame subscriber (attach streams for every session). */
  subscribe(handler: RpcFrameHandler): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  /** Open a dedicated attach socket for one session; returns detach + a
   *  close promise that resolves when the supervisor ends the session (i.e.
   *  the omp child has actually exited). */
  attach(sessionId: string, onFrame: (frame: RpcFrameRecord) => void): Promise<{ detach: () => void; closed: Promise<void> }> {
    return (async () => {
      await this.ensure();
      const socket = createConnection({ host: "127.0.0.1", port: this.port });
      let buffer = "";
      const decoder = new RpcFrameDecoder();
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", () => resolve());
        socket.once("error", reject);
      });
      socket.write(JSON.stringify({ id: "attach-hello", method: "hello", params: { token: this.token } }) + "\n");
      socket.write(JSON.stringify({ id: "attach", method: "agent.attach", params: { sessionId } }) + "\n");
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          let msg: { event?: { type: string; frame?: unknown } };
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          const event = msg.event;
          if (!event) continue;
          if (event.type === "frame" && event.frame && typeof event.frame === "object") {
            // The Rust supervisor nests the raw frame JSON directly, so the
            // event.frame is already a parsed object (not a string).
            onFrame(event.frame as RpcFrameRecord);
          } else if (event.type === "exit") {
            socket.destroy();
          }
        }
      });
      const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
      return { detach: () => socket.destroy(), closed };
    })();
  }

  async spawn(cwd: string, sessionId: string): Promise<{ pid: number }> {
    return (await this.controlRequest("agent.spawn", { cwd, sessionId })) as { pid: number };
  }

  async send(sessionId: string, command: Record<string, unknown>): Promise<unknown> {
    return this.controlRequest("agent.send", { sessionId, command: JSON.stringify(command) });
  }

  async kill(sessionId: string): Promise<void> {
    await this.controlRequest("agent.kill", { sessionId });
  }
}

const hostManager = new RustHostManager();

export class RustRpcProcess {
  readonly cwd: string;
  readonly sessionId: string;
  private readyPromise: Promise<RpcFrameRecord>;
  private frameListeners = new Set<RpcFrameHandler>();
  private exited = false;
  private exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  private protocolVersion: RpcProtocolVersion = 1;
  private detach: (() => void) | null = null;
  private attachClosed: Promise<void> | null = null;
  private onExit?: (info: { stderrTail: string }) => void;
  private nextId = 1;

  constructor(options: RustRpcProcessOptions) {
    this.cwd = options.cwd;
    this.sessionId = options.sessionId;
    this.onExit = options.onExit;
    hostManager.acquire();
    hostManager.subscribe((frame) => {
      if (frame.type === "host_disconnected") {
        if (!this.exited) {
          this.exited = true;
          this.exitInfo = { code: null, signal: null };
          this.onExit?.({ stderrTail: "ompweb-host disconnected" });
        }
        return;
      }
      for (const listener of this.frameListeners) listener(frame);
    });
    this.readyPromise = new Promise<RpcFrameRecord>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Rust supervisor ready timeout")), READY_TIMEOUT_MS);
      const onFrame = (frame: RpcFrameRecord) => {
        if (frame.type === "ready") {
          clearTimeout(timer);
          this.frameListeners.delete(onFrame);
          resolve(frame);
        }
      };
      this.frameListeners.add(onFrame);
    });
    // Boot the host + spawn the session eagerly (constructor parity with
    // RpcProcess, which spawns in the constructor).
    void this.boot();
  }

  private async boot(): Promise<void> {
    try {
      await hostManager.spawn(this.cwd, this.sessionId);
      const stream = await hostManager.attach(this.sessionId, (frame) => {
        for (const listener of this.frameListeners) listener(frame);
      });
      this.detach = stream.detach;
      this.attachClosed = stream.closed;
    } catch (error) {
      if (!this.exited) {
        this.exited = true;
        this.onExit?.({ stderrTail: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  waitReady(timeoutMs?: number): Promise<RpcFrameRecord> {
    const _ = timeoutMs;
    return this.readyPromise;
  }

  onFrame(handler: RpcFrameHandler): () => void {
    this.frameListeners.add(handler);
    return () => this.frameListeners.delete(handler);
  }

  async negotiateProtocol(ready: RpcFrameRecord): Promise<void> {
    const versions = (ready as unknown as { supportedProtocolVersions?: number[] }).supportedProtocolVersions;
    this.protocolVersion = (versions?.includes(2) ? 2 : 1) as RpcProtocolVersion;
    if (this.protocolVersion === 2) {
      await this.sendCommand({ type: "negotiate_protocol", protocolVersion: 2 });
    }
  }

  async sendCommand<T = unknown>(command: { type: string; [key: string]: unknown }): Promise<T> {
    if (this.exited) throw new Error("omp RPC process has exited");
    const id = `w${this.nextId++}`;
    const result = await this.sendWithId(command, id);
    return result as T;
  }

  /** Send a command and resolve with its response frame data. */
  private sendWithId(command: { type: string; [key: string]: unknown }, id: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new RpcCommandError(command.type, "timeout", "timeout")), 60_000);
      timer.unref?.();
      const onFrame = (frame: RpcFrameRecord) => {
        if (frame.id !== id) return;
        clearTimeout(timer);
        this.frameListeners.delete(onFrame);
        if (frame.success === false) {
          reject(new RpcCommandError(command.type, String(frame.error ?? "command failed"), "command_failed"));
        } else {
          resolve(frame.data ?? frame);
        }
      };
      this.frameListeners.add(onFrame);
      void hostManager.send(this.sessionId, { ...command, id }).catch((error) => {
        clearTimeout(timer);
        this.frameListeners.delete(onFrame);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  get isAlive(): boolean {
    return !this.exited;
  }

  get exitedState(): boolean {
    return this.exited;
  }

  async sendFrame(frame: Record<string, unknown>): Promise<void> {
    if (this.exited) throw new Error("omp RPC process has exited");
    await hostManager.send(this.sessionId, frame);
  }

  async dispose(): Promise<void> {
    if (this.exited) return;
    try {
      await hostManager.kill(this.sessionId);
    } catch {
      // kill on a dead session is fine
    }
    // Wait for the omp child to actually exit (the supervisor broadcasts
    // exit only after the child is gone) so its agent.db lock is released
    // before the next session spawns.
    if (this.attachClosed) {
      await Promise.race([
        this.attachClosed,
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
    this.detach?.();
    this.exited = true;
    this.exitInfo = { code: 0, signal: null };
    hostManager.release();
    this.onExit?.({ stderrTail: "" });
  }
}

// ---------------------------------------------------------------------------
// HostClient seam (doc 16 route 2): typed domain surfaces (sessions/journal/
// host) live in host-client.ts and reach the host exclusively through
// hostRequest; this process layer only exposes the low-level request
// primitive. Direct consumers of host IPC must not bypass host-client.
// ---------------------------------------------------------------------------

/** Low-level request over the shared host control connection (ensures the
 * host is running). Used by lib/omp/host-client.ts — the only sanctioned
 * caller for production domain access. */
export async function hostRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
  return hostManager.controlRequest(method, params);
}

/** Shut the shared host down now (kills the supervisor + its omp children).
 * Idle hosts already self-terminate after a grace period; this is the
 * explicit path for clean process shutdown (tests, headless lifecycle). */
export async function shutdownRustHost(): Promise<void> {
  await hostManager.shutdown();
}

/** Factory used by rpc-manager: Rust backend by default. */
export async function createRpcProcess(options: {
  cwd: string;
  sessionId: string;
  extraArgs?: string[];
  onExit?: (info: { stderrTail: string }) => void;
}): Promise<RpcProcessLike> {
  // R8.7: Rust is the primary backend; OMPWEB_BACKEND=node is the explicit
  // rollback (No Hidden Fallback: the switch is user-visible, never silent).
  if (process.env.OMPWEB_BACKEND === "node") {
    const { RpcProcess } = await import("./rpc-process");
    return new RpcProcess({ ...options } as RpcProcessOptions);
  }
  // Route 3 (doc 16): when the host binary is absent the Rust backend is
  // Runtime unavailable — an explicit error with remediation, never a silent
  // fallback to the Node authority (OMPWEB_BACKEND=node is that rollback).
  assertHostAvailable({ moduleDir: MODULE_DIR });
  return new RustRpcProcess({ ...options, sessionId: options.sessionId });
}

export interface RpcProcessLike {
  readonly cwd: string;
  readonly isAlive: boolean;
  waitReady(timeoutMs?: number): Promise<RpcFrameRecord>;
  onFrame(handler: RpcFrameHandler): () => void;
  negotiateProtocol(ready: RpcFrameRecord): Promise<unknown>;
  sendCommand<T = unknown>(command: { type: string; [key: string]: unknown }): Promise<T>;
  sendFrame(frame: Record<string, unknown>): void;
  dispose(): Promise<void>;
}
