import { watch, type FSWatcher } from "fs";
import { join } from "path";
import {
  getAgentDir,
  invalidateSessionListCache,
  resolveSessionIdByPath,
} from "./session-reader";

// omp owns the writes to a session's JSONL. ompweb streams RPC events only for
// the sessions it spawned itself, so a session started outside the web UI — by
// `omp` in a terminal, or by a harness that launches omp — never updated while
// it was open: the file grew and nothing told the browser. This watches the
// session tree and reports which session ids changed, which the running-events
// stream forwards to the client.

type Listener = (sessionIds: string[]) => void;

const DEBOUNCE_MS = 250;

const listeners = new Set<Listener>();
let watcher: FSWatcher | null = null;
let pendingPaths = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  flushTimer = null;
  const paths = [...pendingPaths];
  pendingPaths = new Set();
  if (paths.length === 0) return;

  // A changed file means the cached list's mtimes and message counts are stale.
  invalidateSessionListCache();

  void Promise.all(paths.map((path) => resolveSessionIdByPath(path).catch(() => undefined)))
    .then((ids) => {
      const sessionIds = [...new Set(ids.filter((id): id is string => Boolean(id)))];
      if (sessionIds.length === 0) return;
      for (const listener of listeners) {
        try {
          listener(sessionIds);
        } catch {
          // a failing subscriber must not stop the others
        }
      }
    })
    .catch(() => {
      // resolution failures are not worth tearing the watcher down for
    });
}

function ensureWatcher(): void {
  if (watcher) return;
  const sessionsDir = join(getAgentDir(), "sessions");
  try {
    watcher = watch(sessionsDir, { recursive: true, persistent: false }, (_event, filename) => {
      if (!filename) return;
      const name = filename.toString();
      if (!name.endsWith(".jsonl")) return;
      pendingPaths.add(join(sessionsDir, name));
      if (!flushTimer) flushTimer = setTimeout(flush, DEBOUNCE_MS);
    });
    watcher.on("error", () => {
      watcher?.close();
      watcher = null;
    });
  } catch {
    // No sessions directory yet, or the platform refused a recursive watch.
    // Live updates degrade to the previous behaviour; nothing else breaks.
    watcher = null;
  }
}

export function subscribeSessionFileChanges(listener: Listener): () => void {
  ensureWatcher();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    pendingPaths = new Set();
    watcher?.close();
    watcher = null;
  };
}
