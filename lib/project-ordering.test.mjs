import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  groupSessionsByProject,
  projectActivityByPath,
  projectActivityCounts,
  sortManagedProjects,
} = await jiti.import("./project-ordering.ts");

function session(id, overrides = {}) {
  return {
    path: `/sessions/${id}.jsonl`,
    id,
    cwd: `/work/${id}`,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "hi",
    ...overrides,
  };
}

test("sorts projects with sessions by latest activity, then added projects", () => {
  const projects = [
    { path: "/proj/empty-recent", addedAt: "2026-03-01T00:00:00.000Z" },
    { path: "/proj/empty-old", addedAt: "2026-01-01T00:00:00.000Z" },
    { path: "/proj/older", addedAt: "2026-01-01T00:00:00.000Z" },
    { path: "/proj/newer", addedAt: "2026-01-01T00:00:00.000Z" },
  ];
  const sessions = [
    session("s-newer", { modified: "2026-05-01T00:00:00.000Z", projectRoot: "/proj/newer" }),
    session("s-older", { modified: "2026-04-01T00:00:00.000Z", projectRoot: "/proj/older" }),
  ];
  const sorted = sortManagedProjects(projects, sessions).map((p) => p.path);
  assert.deepEqual(sorted, ["/proj/newer", "/proj/older", "/proj/empty-recent", "/proj/empty-old"]);
});

test("projects without sessions follow in most-recently-added order", () => {
  const projects = [
    { path: "/proj/a", addedAt: "2026-01-01T00:00:00.000Z" },
    { path: "/proj/b", addedAt: "2026-02-01T00:00:00.000Z" },
    { path: "/proj/c", addedAt: "2026-03-01T00:00:00.000Z" },
  ];
  assert.deepEqual(
    sortManagedProjects(projects, []).map((p) => p.path),
    ["/proj/c", "/proj/b", "/proj/a"],
  );
});

test("session-discovered projects without addedAt sort below activity but above nothing", () => {
  const projects = [
    { path: "/proj/registered" }, // discovered, no addedAt
    { path: "/proj/active", addedAt: "2026-01-01T00:00:00.000Z" },
    { path: "/proj/inactive", addedAt: "2026-02-01T00:00:00.000Z" },
  ];
  const sessions = [session("s1", { modified: "2026-06-01T00:00:00.000Z", projectRoot: "/proj/active" })];
  const sorted = sortManagedProjects(projects, sessions).map((p) => p.path);
  // The active project ranks first; the registered (no activity, no addedAt)
  // project sorts below the empty managed ones.
  assert.deepEqual(sorted, ["/proj/active", "/proj/inactive", "/proj/registered"]);
});

test("groups sessions under their project, including worktree sessions", () => {
  const projects = [
    { path: "/repo", addedAt: "2026-01-01T00:00:00.000Z" },
    { path: "/empty", addedAt: "2026-02-01T00:00:00.000Z" },
    { path: "/other" },
  ];
  const sessions = [
    // Worktree session: cwd differs, projectRoot is the main repo.
    session("wt", { cwd: "/repo-worktrees/feature", projectRoot: "/repo" }),
    // Forked session groups under its project like any other session.
    session("fork", { parentSessionId: "parent", projectRoot: "/other" }),
    session("parent", { projectRoot: "/other" }),
  ];
  const grouped = groupSessionsByProject(projects, sessions);
  assert.deepEqual(grouped.get("/repo").map((s) => s.id), ["wt"]);
  // Empty managed project gets an (empty) bucket.
  assert.deepEqual(grouped.get("/empty"), []);
  assert.deepEqual(grouped.get("/other").map((s) => s.id).sort(), ["fork", "parent"]);
});

test("projectActivityByPath tracks the most recent modified per project", () => {
  const sessions = [
    session("s1", { modified: "2026-01-01T00:00:00.000Z", projectRoot: "/repo" }),
    session("s2", { modified: "2026-05-01T00:00:00.000Z", projectRoot: "/repo" }),
  ];
  assert.equal(projectActivityByPath(sessions).get("/repo"), "2026-05-01T00:00:00.000Z");
});

test("projectActivityCounts tallies running and unread per project", () => {
  const sessions = [
    session("running-main", { projectRoot: "/repo" }),
    session("unread-main", { projectRoot: "/repo" }),
    session("running-wt", { cwd: "/repo-worktrees/x", projectRoot: "/repo" }),
    session("idle-other", { projectRoot: "/other" }),
  ];
  const counts = projectActivityCounts(sessions, ["running-main", "running-wt"], ["unread-main"]);
  assert.deepEqual(counts.get("/repo"), { running: 2, unread: 1 });
  assert.deepEqual(counts.get("/other"), { running: 0, unread: 0 });
});
