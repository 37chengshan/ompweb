import type { ManagedProject, SessionInfo } from "./types";

// ============================================================================
// Pure ordering/grouping helpers shared between the sidebar and unit tests.
// All keys are canonical projectRoot paths (worktrees collapse into their main
// repo via resolveProject), so worktree sessions group under their project.
// ============================================================================

/** Latest `modified` timestamp per project (projectRoot), used for the
 *  by-activity ordering of the project list. */
export function projectActivityByPath(sessions: SessionInfo[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const session of sessions) {
    const key = session.projectRoot ?? session.cwd;
    if (!key) continue;
    const prev = latest.get(key);
    if (!prev || session.modified > prev) latest.set(key, session.modified);
  }
  return latest;
}

/** Running/unread session counts per project, for the activity indicators on
 *  project rows. */
export function projectActivityCounts(
  sessions: SessionInfo[],
  runningIds: Iterable<string>,
  unreadIds: Iterable<string>,
): Map<string, { running: number; unread: number }> {
  const running = new Set(runningIds);
  const unread = new Set(unreadIds);
  const result = new Map<string, { running: number; unread: number }>();
  for (const session of sessions) {
    const key = session.projectRoot ?? session.cwd;
    if (!key) continue;
    const current = result.get(key) ?? { running: 0, unread: 0 };
    if (running.has(session.id)) current.running += 1;
    if (unread.has(session.id)) current.unread += 1;
    result.set(key, current);
  }
  return result;
}

/** Sort projects by latest session activity (desc); projects without sessions
 *  follow in most-recently-added (addedAt desc) order. Projects with activity
 *  always rank above projects without. */
export function sortManagedProjects(
  projects: ManagedProject[],
  sessions: SessionInfo[],
): ManagedProject[] {
  const activity = projectActivityByPath(sessions);
  return [...projects].sort((a, b) => {
    const aActivity = activity.get(a.path);
    const bActivity = activity.get(b.path);
    if (aActivity && bActivity) return bActivity.localeCompare(aActivity);
    if (aActivity) return -1;
    if (bActivity) return 1;
    return (b.addedAt ?? "").localeCompare(a.addedAt ?? "");
  });
}

/** Group sessions under their project. Every project in `projects` gets an
 *  entry (possibly empty) so empty managed projects render their empty state. */
export function groupSessionsByProject(
  projects: ManagedProject[],
  sessions: SessionInfo[],
): Map<string, SessionInfo[]> {
  const grouped = new Map<string, SessionInfo[]>();
  for (const project of projects) grouped.set(project.path, []);
  for (const session of sessions) {
    const key = session.projectRoot ?? session.cwd;
    if (!key) continue;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(session);
  }
  return grouped;
}
