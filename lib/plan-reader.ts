import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "fs";
import { basename, dirname, join } from "path";

export interface PlanArtifact {
  /** True when the session's jsonl contains a plan-mode-context entry. */
  planModeActive: boolean;
  /** Absolute path of the newest `<session-dir>/local/*-plan.md`, or null. */
  planPath: string | null;
  /** Plan slug (file name without .md), or null. */
  planSlug: string | null;
}

const PLAN_MODE_CONTEXT_MARKER = '"customType":"plan-mode-context"';
// Plan-mode context entries are injected near the start of a session; reading
// the first chunk is enough to detect the mode without scanning huge files.
const MODE_SCAN_BYTES = 2 * 1024 * 1024;

/**
 * Resolve a session's plan artifact: whether it ran in omp plan mode and where
 * its canonical plan document lives. omp writes plan-mode context entries into
 * the session jsonl and the model's plan markdown to
 * `<session-file-dir>/<session-base>/local/<slug>-plan.md`.
 */
export function resolvePlanArtifact(sessionFilePath: string): PlanArtifact {
  let planModeActive = false;
  try {
    const size = statSync(sessionFilePath).size;
    const fd = openSync(sessionFilePath, "r");
    try {
      const buf = Buffer.alloc(Math.min(MODE_SCAN_BYTES, size));
      const bytes = readSync(fd, buf, 0, buf.length, 0);
      planModeActive = buf.subarray(0, bytes).includes(Buffer.from(PLAN_MODE_CONTEXT_MARKER));
    } finally {
      closeSync(fd);
    }
  } catch {
    // Unreadable session file — treat as no plan.
  }

  let planPath: string | null = null;
  const localDir = join(dirname(sessionFilePath), basename(sessionFilePath, ".jsonl"), "local");
  try {
    if (existsSync(localDir)) {
      const plans = readdirSync(localDir)
        .filter((name) => name.endsWith("-plan.md"))
        .map((name) => {
          try {
            return { name, mtime: statSync(join(localDir, name)).mtimeMs };
          } catch {
            // File vanished mid-scan — skip it rather than losing all plans.
            return null;
          }
        })
        .filter((entry): entry is { name: string; mtime: number } => entry !== null)
        .sort((a, b) => b.mtime - a.mtime);
      if (plans.length > 0) planPath = join(localDir, plans[0].name);
    }
  } catch {
    // No artifacts directory.
  }

  return {
    planModeActive,
    planPath,
    planSlug: planPath ? basename(planPath, ".md") : null,
  };
}
