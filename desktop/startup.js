"use strict";

/**
 * Desktop startup state machine + server health probe (doc 14 T1.1–T1.4).
 *
 * Pure Node logic with injectable clock/fetch so node:test drives every path
 * without Electron. desktop/main.js wires it to the real app; the Web UI
 * reports shell_mounted / session_interactive through the preload bridge.
 *
 * State machine (doc 14 T1.3):
 *   spawning → listening → assets_warmed → shell_mounted → session_interactive
 *   failed is terminal and may be entered from any state (T1.4).
 * The tracker never moves backwards; `failed` is the only terminal state.
 */

const ORDER = Object.freeze([
  "spawning",
  "listening",
  "assets_warmed",
  "shell_mounted",
  "session_interactive",
]);

const STAGES = new Set([...ORDER, "failed"]);

class StartupTracker {
  /**
   * @param {{ now?: () => number, log?: (line: string) => void }} opts
   */
  constructor({ now = () => Date.now(), log = () => {} } = {}) {
    this._now = now;
    this._log = log;
    this._t0 = now();
    this._timestamps = new Map([["spawning", 0]]);
    this._order = ["spawning"];
    this._failure = null;
    this._terminal = false;
    this._log("startup[+0ms] spawning");
  }

  get state() {
    return this._order[this._order.length - 1];
  }

  get failure() {
    return this._failure;
  }

  _record(state, meta) {
    const t = this._now() - this._t0;
    if (!this._timestamps.has(state)) this._order.push(state);
    this._timestamps.set(state, t);
    const suffix = meta && Object.keys(meta).length > 0 ? " " + JSON.stringify(meta) : "";
    this._log(`startup[+${t}ms] ${state}${suffix}`);
    return t;
  }

  /**
   * Advance to the next ordered stage. Idempotent for the current stage;
   * throws on backwards/terminal misuse — ordering bugs must fail loudly.
   */
  record(state, meta) {
    if (!STAGES.has(state)) throw new Error("unknown startup stage: " + state);
    if (this._terminal) throw new Error("startup already failed (" + this.state + ")");
    // listening and assets_warmed are parallel: the splash warms bundles as
    // soon as the server answers its first request, which can beat the
    // health probe's success (or trail it on slow starts). Either order is
    // valid; shell_mounted onwards must never be re-entered.
    if (state !== this.state && state !== "spawning" && (state === "assets_warmed" || state === "listening") && (this.state === "assets_warmed" || this.state === "listening")) {
      return this._record(state, meta);
    }
    const idx = ORDER.indexOf(state);
    const cur = ORDER.indexOf(this.state);
    if (idx < cur) throw new Error(`startup stage regressed: ${this.state} -> ${state}`);
    return this._record(state, meta);
  }

  /** Enter the terminal failed state with a stable reason (T1.4). */
  fail(reason, meta = {}) {
    if (this._terminal) return this._timestamps.get("failed");
    this._terminal = true;
    this._failure = { reason, ...meta };
    return this._record("failed", { reason, ...meta });
  }

  /** Machine-readable report for logs and the diagnostics dashboard (P40). */
  report() {
    const timestamps = {};
    for (const [s, t] of this._timestamps) timestamps[s] = t;
    return {
      state: this.state,
      failure: this._failure,
      timestamps,
      elapsedMs: this._now() - this._t0,
    };
  }
}

/**
 * Health probe for the standalone server (doc 14 T1.7). A server is ready
 * only when the dedicated /api/health endpoint answers ok with the expected
 * app version — any HTTP status (404/500) or version mismatch stays not-ready.
 *
 * @param {{
 *   appUrl: string,
 *   expectedAppVersion?: string,
 *   fetchFn?: typeof fetch,
 *   timeoutMs?: number,
 *   maxAttempts?: number,
 *   backoffMs?: number,
 *   now?: () => number,
 * }} opts
 */
function createHealthProbe({
  appUrl,
  expectedAppVersion,
  fetchFn = fetch,
  timeoutMs = 1500,
  maxAttempts = 60,
  backoffMs = 700,
  now = () => Date.now(),
} = {}) {
  let attempt = 0;

  async function probeOnce() {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = now();
    const base = { attempt };
    try {
      const res = await fetchFn(appUrl + "/api/health", { signal: controller.signal });
      if (!res.ok) return { ...base, ready: false, reason: `http-${res.status}` };
      let body;
      try {
        body = await res.json();
      } catch {
        return { ...base, ready: false, reason: "bad-json" };
      }
      if (!body || body.ok !== true) return { ...base, ready: false, reason: "health-not-ok" };
      if (expectedAppVersion && body.app !== expectedAppVersion) {
        return { ...base, ready: false, reason: "version-mismatch", got: body.app };
      }
      return {
        ...base,
        ready: true,
        elapsedMs: now() - started,
        ompReady: !!body.ompReady,
        ompVersion: body.ompVersion ?? null,
      };
    } catch (err) {
      return { ...base, ready: false, reason: "unreachable", error: err && err.name };
    } finally {
      clearTimeout(timer);
    }
  }

  async function wait({ onAttempt = () => {}, onFail = () => {} } = {}) {
    for (;;) {
      const result = await probeOnce();
      onAttempt(result);
      if (result.ready) return result;
      if (attempt >= maxAttempts) {
        onFail(result);
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  return { probeOnce, wait };
}

module.exports = { StartupTracker, createHealthProbe, ORDER, STAGES };
