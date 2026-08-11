"use client";

import { memo, useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo, type CSSProperties, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import type { ManagedProject, SessionInfo } from "@/lib/types";
import { translate, useI18n } from "@/lib/i18n";
import { formatApiError } from "@/lib/i18n/api-error";
import { DirectoryPicker } from "./DirectoryPicker";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { Tooltip } from "./ui/primitives";
import { toast } from "./ui/toast";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { clearLastOpenSession, setLastOpenSession, workspaceKeyOf } from "@/lib/workspace-memory";
import { groupSessionsByProject, projectActivityCounts, sortManagedProjects } from "@/lib/project-ordering";
import { Archive, Check, ChevronDown, ChevronRight, GitBranch, Pencil, Plus, RefreshCw, Trash2, Upload } from "lucide-react";

declare global {
  interface Window {
    piDesktop?: {
      selectDirectory: () => Promise<string | null>;
    };
  }
}

interface Props {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  skipInitialProjectSelection?: boolean;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (cwd: string | null, projectRoot?: string | null) => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
  explorerRefreshKey?: number;
  onExplorerRefresh?: () => void;
  explorerRefreshing?: boolean;
  onExplorerRefreshDone?: () => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

interface WorktreeState {
  /** The cwd this data was fetched for — guards against stale responses */
  forCwd: string;
  projectRoot: string;
  isGit: boolean;
  /** False when forCwd is a repo subdirectory — the switcher is hidden there
   *  because subdir sessions keep their own project identity */
  isTopLevel: boolean;
  worktrees: WorktreeEntry[];
}

const UNREAD_SESSIONS_STORAGE_KEY = "omp-web:unread-session-ids";

function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(UNREAD_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

const EXPANDED_PROJECTS_STORAGE_KEY = "omp-web:expanded-projects";

/** Shared empty set for the no-stored-expansion default (never mutated). */
const EMPTY_PROJECT_SET: ReadonlySet<string> = new Set();

/** Persisted expanded-project paths. Returns null when nothing was stored —
 *  the sidebar then defaults to expanding only the active project. */
function loadExpandedProjects(): Set<string> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(EXPANDED_PROJECTS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((path): path is string => typeof path === "string" && path.length > 0));
    }
    return null;
  } catch {
    return null;
  }
}

function saveExpandedProjects(paths: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EXPANDED_PROJECTS_STORAGE_KEY, JSON.stringify([...paths]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

/** Substitute the home dir prefix with ~ (no path truncation — see PathLabel) */
function displayCwd(cwd: string, homeDir?: string): string {
  return (homeDir && cwd.startsWith(homeDir)) ? "~" + cwd.slice(homeDir.length) : cwd;
}

/** Final folder name of a project path, portable across / and \ separators. */
function projectLabel(projectPath: string): string {
  const trimmed = projectPath.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

/**
 * Path label that ellipsizes on the LEFT, keeping the (most relevant) trailing
 * segments visible: "…orkspace/pi-web". Shows as much of the path as fits
 * instead of a fixed number of segments. The rtl container moves the ellipsis
 * to the left edge; the inner plaintext bidi isolation keeps the path itself
 * rendered strictly left-to-right (no punctuation reordering).
 */
function PathLabel({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        minWidth: 0,
        lineHeight: 1.35,
        direction: "rtl",
        textAlign: "left",
        ...style,
      }}
    >
      <span style={{ unicodeBidi: "plaintext" }}>{text}</span>
    </span>
  );
}

const DROPDOWN_ANIMATION_MS = 140;

function AnimatedDropdown({ open, children, style }: { open: boolean; children: ReactNode; style: CSSProperties }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    let frame: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (open) {
      setMounted(true);
      setVisible(false);
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      timeout = setTimeout(() => setMounted(false), DROPDOWN_ANIMATION_MS);
    }

    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timeout) clearTimeout(timeout);
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      style={{
        ...style,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(-8px) scale(0.96)",
        transformOrigin: "top center",
        transition: "opacity var(--dur-fast) var(--ease-out-warm), transform var(--dur-fast) var(--ease-out-warm)",
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
}



interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
}

function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
  const byId = new Map<string, SessionTreeNode>();
  for (const s of sessions) {
    byId.set(s.id, { session: s, children: [] });
  }

  // Build a map of parentSessionId chains so we can resolve missing ancestors
  const parentOf = new Map<string, string>();
  for (const s of sessions) {
    if (s.parentSessionId) parentOf.set(s.id, s.parentSessionId);
  }

  // Walk up the parentSessionId chain to find the nearest ancestor that exists in byId
  function resolveAncestor(id: string): string | null {
    let cur = parentOf.get(id);
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur)) return null; // cycle guard
      visited.add(cur);
      if (byId.has(cur)) return cur;
      cur = parentOf.get(cur);
    }
    return null;
  }

  const roots: SessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id);
    if (ancestor) {
      byId.get(ancestor)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort each level by modified desc
  const sort = (nodes: SessionTreeNode[]) => {
    nodes.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

function useScramble(target: string, running: boolean, reducedMotion: boolean): string {
  const [display, setDisplay] = useState(target);
  const frameRef = useRef<number | null>(null);
  const iterRef = useRef(0);

  useEffect(() => {
    if (!running || reducedMotion) {
      setDisplay(target);
      return;
    }
    iterRef.current = 0;
    const totalFrames = target.length * 4;

    const step = () => {
      iterRef.current += 1;
      const progress = iterRef.current / totalFrames;
      const resolved = Math.floor(progress * target.length);

      setDisplay(
        target
          .split("")
          .map((char, i) => {
            if (char === " ") return " ";
            if (i < resolved) return char;
            return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
          })
          .join("")
      );

      if (iterRef.current < totalFrames) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(target);
      }
    };

    frameRef.current = requestAnimationFrame(step);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [target, running, reducedMotion]);

  return display;
}

function OmpWebTitle() {
  const [showVersion, setShowVersion] = useState(false);
  const [scrambling, setScrambling] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrambleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const target = showVersion ? `v${process.env.NEXT_PUBLIC_OMP_WEB_VERSION ?? "0.0.0"}` : "omp web";
  const display = useScramble(target, scrambling, reducedMotion);

  const triggerScramble = useCallback((toVersion: boolean) => {
    setShowVersion(toVersion);
    if (scrambleTimerRef.current) clearTimeout(scrambleTimerRef.current);
    if (reducedMotion) return;
    setScrambling(true);
    scrambleTimerRef.current = setTimeout(() => setScrambling(false), (toVersion ? 6 : 8) * 4 * (1000 / 60) + 100);
  }, [reducedMotion]);

  const handleClick = useCallback(() => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);

    const next = !showVersion;
    triggerScramble(next);

    if (next) {
      revertTimerRef.current = setTimeout(() => triggerScramble(false), 3000);
    }
  }, [showVersion, triggerScramble]);

  useEffect(() => () => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    if (scrambleTimerRef.current) clearTimeout(scrambleTimerRef.current);
  }, []);

  return (
    <button
      onClick={handleClick}
      style={{
        background: "none", border: "none", padding: 0, cursor: "pointer",
        fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em",
        color: showVersion ? "var(--accent)" : "var(--text)",
        fontFamily: "var(--font-mono)",
        minWidth: "6ch",
      }}
      title={showVersion ? "Show ompweb name" : "Show ompweb version"}
    >
      {display}
    </button>
  );
}

export function SessionSidebar({ selectedSessionId, onSelectSession, onNewSession, initialSessionId, skipInitialProjectSelection, onInitialRestoreDone, refreshKey, onSessionDeleted, selectedCwd: selectedCwdProp, onCwdChange, onOpenFile, explorerRefreshKey, onExplorerRefresh, explorerRefreshing, onExplorerRefreshDone, onAtMention, onAtMentions }: Props) {
  const { t } = useI18n();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  // Managed + session-discovered projects (server-merged, hidden excluded).
  const [projects, setProjects] = useState<ManagedProject[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  // Add-project picker state.
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [addProjectBusy, setAddProjectBusy] = useState(false);
  const [addProjectError, setAddProjectError] = useState<string | null>(null);
  // Per-project expansion, persisted to localStorage (null = nothing stored).
  const [expandedProjects, setExpandedProjects] = useState<Set<string> | null>(() => loadExpandedProjects());
  // Project currently being removed (hide) — serializes remove requests.
  const [removeProjectPath, setRemoveProjectPath] = useState<string | null>(null);
  // Worktree switcher state
  const [worktreeState, setWorktreeState] = useState<WorktreeState | null>(null);
  const [wtDropdownOpen, setWtDropdownOpen] = useState(false);
  const [wtNewOpen, setWtNewOpen] = useState(false);
  const [wtNewBranch, setWtNewBranch] = useState("");
  const [wtError, setWtError] = useState<string | null>(null);
  const [wtBusy, setWtBusy] = useState(false);
  const [wtConfirmRemove, setWtConfirmRemove] = useState<string | null>(null);
  const [worktreeLoadingCwd, setWorktreeLoadingCwd] = useState<string | null>(null);
  const wtDropdownRef = useRef<HTMLDivElement>(null);
  const wtNewInputRef = useRef<HTMLInputElement>(null);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerKey, setExplorerKey] = useState(0);
  const [explorerUploadBusy, setExplorerUploadBusy] = useState(false);
  const [sessionRefreshDone, setSessionRefreshDone] = useState(false);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  // Once the SSE stream has delivered a frame it is the source of truth for
  // running state; late /api/sessions responses must not overwrite it.
  const sseAuthoritativeRef = useRef(false);
  const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileExplorerRef = useRef<FileExplorerHandle>(null);

  const loadSessions = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { sessions: SessionInfo[]; runningSessionIds?: string[] };
      setAllSessions(data.sessions);
      // Treat the fetched running set as an initial fallback only. Once SSE is
      // live it owns this state, so a slow fetch can't revive a stale snapshot.
      if (!sseAuthoritativeRef.current) {
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
      }
      // Drop unread markers for sessions that no longer exist (e.g. deleted).
      const existingIds = new Set(data.sessions.map((s) => s.id));
      setUnreadSessionIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set([...prev].filter((id) => existingIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setError(null);
      if (!showLoading) {
        setSessionRefreshDone(true);
        if (sessionRefreshTimerRef.current) clearTimeout(sessionRefreshTimerRef.current);
        sessionRefreshTimerRef.current = setTimeout(() => setSessionRefreshDone(false), 2000);
      }
    } catch (e) {
      setError(translate("sessionSidebar.loadFailed", { detail: e instanceof Error ? e.message : String(e) }));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    loadSessions(isFirst);
  }, [loadSessions, refreshKey]);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { projects?: ManagedProject[] };
      setProjects(data.projects ?? []);
      setProjectsError(null);
      projectsLoadedRef.current = true;
    } catch (e) {
      setProjectsError(translate("projects.loadFailed", { detail: e instanceof Error ? e.message : String(e) }));
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects, refreshKey]);

  // Persist expansion state; null means nothing was stored yet.
  useEffect(() => {
    if (expandedProjects === null) return;
    saveExpandedProjects(expandedProjects);
  }, [expandedProjects]);

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  useEffect(() => {
    // Live running status and session-list invalidations arrive via SSE; the
    // sidebar never has to poll while an agent is working.
    const source = new EventSource("/api/agent/running/events");

    source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as {
          type?: string;
          runningSessionIds?: string[];
          refreshSessionList?: boolean;
        };
        if (data.type === "running") {
          sseAuthoritativeRef.current = true;
          setRunningSessionIds(new Set(data.runningSessionIds ?? []));
          if (data.refreshSessionList) void loadSessions(false);
        }
      } catch {
        // ignore malformed frames
      }
    };

    // On error EventSource auto-reconnects; keep the last known state meanwhile.
    return () => source.close();
  }, [loadSessions]);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter((id) => !runningSessionIds.has(id) && id !== selectedSessionId);
    const newlyRunning = [...runningSessionIds];

    if (completedInBackground.length > 0 || newlyRunning.length > 0) {
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        newlyRunning.forEach((id) => next.delete(id));
        completedInBackground.forEach((id) => next.add(id));
        return next;
      });
    }
    if (completedInBackground.length > 0) {
      loadSessions(false);
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
  }, [runningSessionIds, selectedSessionId, loadSessions]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((prev) => {
      if (!prev.has(selectedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSessionId]);

  useEffect(() => {
    if (explorerRefreshKey !== undefined) setExplorerKey((k) => k + 1);
  }, [explorerRefreshKey]);

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then((d: { home?: string }) => {
      if (d.home) setHomeDir(d.home);
    }).catch(() => {});
  }, []);

  const restoredRef = useRef(false);
  /** Set once the first /api/projects fetch succeeds; guards the expansion
   *  prune against running on an empty (still-loading) project list. */
  const projectsLoadedRef = useRef(false);

  /** Resolve the project root for a cwd from the freshest data available */
  const projectRootFor = useCallback((cwd: string | null): string | null => {
    if (!cwd) return null;
    if (worktreeState && worktreeState.forCwd === cwd) return worktreeState.projectRoot;
    // Any path in the loaded worktree list belongs to that project — covers
    // worktrees without sessions, so switching to them keeps the row mounted.
    if (worktreeState?.worktrees.some((w) => w.path === cwd)) return worktreeState.projectRoot;
    // A registered project path is its own canonical root.
    if (projects.some((p) => p.path === cwd)) return cwd;
    const match = allSessions.find((s) => s.cwd === cwd);
    return match?.projectRoot ?? cwd;
  }, [worktreeState, allSessions, projects]);

  // ---- Expansion (used by the sync/notify effects below, so declared first) --
  const expandProject = useCallback((path: string) => {
    setExpandedProjects((prev) => {
      if (prev?.has(path)) return prev;
      const next = new Set(prev ?? []);
      next.add(path);
      return next;
    });
  }, []);

  const collapseProject = useCallback((path: string) => {
    setExpandedProjects((prev) => {
      if (!prev?.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }, []);

  const toggleProjectExpanded = useCallback((path: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  /** Activate a project (effective cwd = its root) and expand it, without
   *  opening a session. */
  const activateProject = useCallback((path: string) => {
    provisionalSelectionRef.current = false;
    setSelectedCwd(path);
    expandProject(path);
  }, [expandProject]);

  // Notify parent only when the effective cwd actually changes (not when
  // projectRootFor identity changes due to session/worktree refreshes).
  const lastNotifiedCwdRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastNotifiedCwdRef.current === selectedCwd) return;
    lastNotifiedCwdRef.current = selectedCwd;
    onCwdChange?.(selectedCwd, projectRootFor(selectedCwd));
  }, [selectedCwd, onCwdChange, projectRootFor]);

  // Sync the worktree switcher to the selected session's cwd. Sessions of all
  // worktrees in a project share one list, so clicking a session from another
  // worktree should move the effective cwd there. Only fires when the prop
  // value changes, so a manual switcher change is not snapped back. Sessions
  // picked outside the sidebar (URL restore, command palette) also expand
  // their containing project.
  const lastSyncedCwdPropRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = selectedCwdProp;
      setSelectedCwd(selectedCwdProp);
      const project = projectRootFor(selectedCwdProp);
      if (project) expandProject(project);
    }
  }, [selectedCwdProp, projectRootFor, expandProject]);

  // Load worktrees for the current effective cwd
  const [wtRefreshKey, setWtRefreshKey] = useState(0);
  useLayoutEffect(() => {
    if (!selectedCwd) {
      setWorktreeState(null);
      setWorktreeLoadingCwd(null);
      return;
    }
    let cancelled = false;
    setWorktreeLoadingCwd(selectedCwd);
    fetch(`/api/worktrees?cwd=${encodeURIComponent(selectedCwd)}`)
      .then((r) => r.json())
      .then((d: { projectRoot?: string; isGit?: boolean; isTopLevel?: boolean; worktrees?: WorktreeEntry[]; error?: string }) => {
        if (cancelled) return;
        setWorktreeLoadingCwd(null);
        if (d.error || !d.projectRoot) {
          setWorktreeState(null);
          return;
        }
        setWorktreeState({
          forCwd: selectedCwd,
          projectRoot: d.projectRoot,
          isGit: d.isGit ?? false,
          isTopLevel: d.isTopLevel ?? false,
          worktrees: d.worktrees ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setWorktreeLoadingCwd(null);
          setWorktreeState(null);
        }
      });
    return () => { cancelled = true; };
  }, [selectedCwd, wtRefreshKey, refreshKey]);

  // ---- Derived project list ---------------------------------------------------
  const selectedProject = useMemo(() => projectRootFor(selectedCwd), [projectRootFor, selectedCwd]);
  const sortedProjects = useMemo(() => sortManagedProjects(projects, allSessions), [projects, allSessions]);
  const sessionsByProject = useMemo(
    () => groupSessionsByProject(sortedProjects, allSessions),
    [sortedProjects, allSessions],
  );
  const projectActivity = useMemo(
    () => projectActivityCounts(allSessions, runningSessionIds, unreadSessionIds),
    [allSessions, runningSessionIds, unreadSessionIds],
  );

  // Drop persisted expansion keys whose project no longer exists (removed or
  // vanished), so the storage stays bounded to real projects. Only runs after
  // the first project fetch — an empty list mid-load must never wipe storage.
  useEffect(() => {
    if (expandedProjects === null || !projectsLoadedRef.current) return;
    const known = new Set(sortedProjects.map((p) => p.path));
    const stale = [...expandedProjects].filter((path) => !known.has(path));
    if (stale.length === 0) return;
    setExpandedProjects((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      stale.forEach((path) => next.delete(path));
      return next;
    });
  }, [expandedProjects, sortedProjects]);

  // True while the auto-selected project was chosen before sessions loaded
  // (activity ordering unknown); cleared by any manual activation.
  const provisionalSelectionRef = useRef(false);

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    if (skipInitialProjectSelection) return;

    // If restoring a session, set cwd to match that session
    if (initialSessionId && !restoredRef.current) {
      if (allSessions.length === 0) return; // wait for sessions to load
      restoredRef.current = true;
      const target = allSessions.find((s) => s.id === initialSessionId);
      if (target) {
        setSelectedCwd(target.cwd);
        expandProject(workspaceKeyOf(target));
        onSelectSession(target, true);
        return;
      }
      // Session not found — notify parent so it can show the placeholder
      onInitialRestoreDone?.();
    }
    // No restore target: activate the top project (by activity, then
    // most-recently-added) so New Session and Explorer have a context. When
    // sessions have not loaded yet the ordering is provisional — re-pick once
    // they arrive, unless the user already activated a project by hand.
    if (selectedCwd !== null && !provisionalSelectionRef.current) return;
    const top = sortedProjects[0];
    if (!top) return;
    setSelectedCwd(top.path);
    expandProject(top.path);
    provisionalSelectionRef.current = allSessions.length === 0;
  }, [allSessions, selectedCwd, initialSessionId, skipInitialProjectSelection, onSelectSession, onInitialRestoreDone, sortedProjects, expandProject]);

  // Default expansion: when the user has never stored an expansion choice,
  // expand only the active project.
  const defaultExpandedRef = useRef(false);
  useEffect(() => {
    if (defaultExpandedRef.current) return;
    const project = selectedProject;
    if (!project) return;
    defaultExpandedRef.current = true;
    if (expandedProjects === null) expandProject(project);
  }, [selectedProject, expandedProjects, expandProject]);

  const commitAddProject = useCallback(async (candidate?: string) => {
    const path = (candidate ?? "").trim();
    if (!path || addProjectBusy) return;

    setAddProjectBusy(true);
    setAddProjectError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as { project?: ManagedProject; error?: string; code?: string };
      if (!res.ok || data.error || !data.project) {
        setAddProjectError(formatApiError({ ...data, error: data.error ?? `HTTP ${res.status}` }));
        return;
      }
      await loadProjects();
      // Activate + expand the newly added project and close the picker.
      setSelectedCwd(data.project.path);
      expandProject(data.project.path);
      setAddProjectOpen(false);
    } catch (e) {
      setAddProjectError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddProjectBusy(false);
    }
  }, [addProjectBusy, loadProjects, expandProject]);

  const handleRemoveProject = useCallback(async (projectPath: string) => {
    if (removeProjectPath) return;
    setRemoveProjectPath(projectPath);
    try {
      const res = await fetch("/api/projects", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectPath }),
      });
      const data = await res.json().catch(() => ({})) as { success?: boolean; error?: string; code?: string };
      if (!res.ok || !data.success) {
        toast.error(formatApiError({ ...data, error: data.error ?? `HTTP ${res.status}` }));
        return;
      }
      // Hiding the active project leaves nothing selected; activate the next
      // most-relevant project so New Session and Explorer stay usable.
      if (selectedProject === projectPath) {
        const next = sortedProjects.find((p) => p.path !== projectPath);
        setSelectedCwd(next ? next.path : null);
      }
      collapseProject(projectPath);
      await loadProjects();
    } finally {
      setRemoveProjectPath(null);
    }
  }, [removeProjectPath, selectedProject, sortedProjects, collapseProject, loadProjects]);

  const handleCreateWorktree = useCallback(async () => {
    const branch = wtNewBranch.trim();
    if (!branch || wtBusy || !worktreeState) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, branch }),
      });
      const data = await res.json().catch(() => ({})) as { path?: string; error?: string; code?: string };
      if (!res.ok || data.error || !data.path) {
        setWtError(formatApiError({ ...data, error: data.error ?? `HTTP ${res.status}` }));
        return;
      }
      setWtNewOpen(false);
      setWtNewBranch("");
      setWtDropdownOpen(false);
      // Optimistically register the new worktree so projectRootFor() resolves
      // it to the main repo before the refetch lands (keeps AppShell from
      // treating the new cwd as a different project).
      setWorktreeState((prev) => prev ? {
        ...prev,
        forCwd: data.path!,
        worktrees: [...prev.worktrees, { path: data.path!, branch, isMain: false }],
      } : prev);
      setSelectedCwd(data.path);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [wtNewBranch, wtBusy, worktreeState]);

  const handleRemoveWorktree = useCallback(async (path: string, force: boolean) => {
    if (!worktreeState || wtBusy) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, path, force }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; dirty?: boolean; code?: string };
      if (!res.ok) {
        if (data.dirty && !force) {
          // Dirty worktree — ask the user to confirm a force removal
          setWtConfirmRemove(path);
          return;
        }
        setWtError(formatApiError({ ...data, error: data.error ?? `HTTP ${res.status}` }));
        return;
      }
      setWtConfirmRemove(null);
      if (selectedCwd === path) setSelectedCwd(worktreeState.projectRoot);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [worktreeState, wtBusy, selectedCwd]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wtDropdownRef.current && !wtDropdownRef.current.contains(e.target as Node)) {
        setWtDropdownOpen(false);
        setWtNewOpen(false);
        setWtNewBranch("");
        setWtError(null);
        setWtConfirmRemove(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees. Selecting a session also
  // activates and expands its containing project.
  const handleSelectSessionFromList = useCallback((s: SessionInfo) => {
    provisionalSelectionRef.current = false;
    if (s.cwd) setSelectedCwd(s.cwd);
    expandProject(workspaceKeyOf(s));
    onSelectSession(s);
  }, [onSelectSession, expandProject]);

  const handleNewSession = useCallback(() => {
    if (!selectedCwd) return;
    // Generate a temporary UUID client-side — no backend call needed.
    // Pi will be spawned lazily when the user sends the first message.
    const tempId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    onNewSession?.(tempId, selectedCwd);
  }, [selectedCwd, onNewSession]);

  // Sessions of every worktree in the selected project are shown together
  const expandedProjectPaths = expandedProjects ?? EMPTY_PROJECT_SET;
  const showWorktreeSwitcher = Boolean(
    worktreeState?.isGit
    && worktreeState.isTopLevel
    && selectedCwd
    && selectedProject === worktreeState.projectRoot
  );
  const worktreeGuide = selectedCwd
    && worktreeState
    && selectedProject === worktreeState.projectRoot
    && !showWorktreeSwitcher
    ? (worktreeState.isGit
        ? {
            label: t("sessionSidebar.openRepoRoot"),
            title: t("sessionSidebar.openRepoRootTitle"),
          }
        : {
            label: t("sessionSidebar.gitRepoRootOnly"),
            title: t("sessionSidebar.gitRepoRootOnlyTitle"),
          })
    : null;
  const worktreeLoading = Boolean(selectedCwd && worktreeLoadingCwd === selectedCwd);
  const inactiveWorktreeSelector = worktreeGuide
    ?? (worktreeLoading && !showWorktreeSwitcher
      ? {
          label: t("sessionSidebar.worktreesLoading"),
          title: t("sessionSidebar.worktreesLoadingTitle"),
        }
      : null);

  // Stable callbacks for the session list so memoized children don't re-render
  // on every parent state change.
  const handleSessionDeleted = useCallback((id: string) => {
    const deleted = allSessions.find((session) => session.id === id);
    if (deleted) clearLastOpenSession(workspaceKeyOf(deleted));
    onSessionDeleted?.(id);
    loadSessions();
  }, [allSessions, onSessionDeleted, loadSessions]);

  useEffect(() => {
    const selected = allSessions.find((session) => session.id === selectedSessionId);
    if (selected) setLastOpenSession(workspaceKeyOf(selected), selected.id);
  }, [allSessions, selectedSessionId]);

  // The active project's worktree selector (or its inactive guide) renders
  // directly below the active project row. Built once — each ProjectRow only
  // renders them when it is the active project.
  const activeProjectSwitcher = showWorktreeSwitcher && worktreeState ? (
    <div style={{ paddingLeft: 42, paddingRight: 12, marginTop: 4 }}>
      <ProjectWorktreeSwitcher
        worktreeState={worktreeState}
        selectedCwd={selectedCwd}
        homeDir={homeDir}
        wtDropdownOpen={wtDropdownOpen}
        setWtDropdownOpen={setWtDropdownOpen}
        wtNewOpen={wtNewOpen}
        setWtNewOpen={setWtNewOpen}
        wtNewBranch={wtNewBranch}
        setWtNewBranch={setWtNewBranch}
        wtError={wtError}
        setWtError={setWtError}
        wtBusy={wtBusy}
        wtConfirmRemove={wtConfirmRemove}
        setWtConfirmRemove={setWtConfirmRemove}
        onSelectWorktree={(path) => {
          setSelectedCwd(path);
          setWtDropdownOpen(false);
          setWtError(null);
        }}
        onCreateWorktree={handleCreateWorktree}
        onRemoveWorktree={(path, force) => void handleRemoveWorktree(path, force)}
        dropdownRef={wtDropdownRef}
        newInputRef={wtNewInputRef}
      />
    </div>
  ) : null;
  const activeProjectGuide = !showWorktreeSwitcher && inactiveWorktreeSelector ? (
    <div style={{ paddingLeft: 42, paddingRight: 12, marginTop: 4 }}>
      <button
        type="button"
        aria-disabled="true"
        tabIndex={-1}
        title={inactiveWorktreeSelector.title}
        style={{
          width: "100%",
          height: 29,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 10px",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-control)",
          background: "var(--bg-hover)",
          color: "var(--text-dim)",
          fontSize: 11,
          lineHeight: 1.35,
          whiteSpace: "nowrap",
          textAlign: "left",
          cursor: "default",
          opacity: 0.82,
        }}
      >
        <GitBranch size={12} strokeWidth={2} style={{ flexShrink: 0 }} aria-hidden="true" />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{inactiveWorktreeSelector.label}</span>
      </button>
    </div>
  ) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {addProjectOpen && (
        <DirectoryPicker
          busy={addProjectBusy}
          error={addProjectError}
          onCancel={() => {
            setAddProjectOpen(false);
            setAddProjectError(null);
          }}
          onSelect={(path) => void commitAddProject(path)}
        />
      )}
      {/* Header */}
      <div
        style={{
          padding: "12px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <OmpWebTitle />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={handleNewSession}
              disabled={!selectedCwd}
              className="display-serif"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                background: "var(--bg-hover)",
                border: "1px solid var(--border)",
                color: selectedCwd ? "var(--text-muted)" : "var(--text-dim)",
                cursor: selectedCwd ? "pointer" : "not-allowed",
                height: 32,
                paddingLeft: 10,
                paddingRight: 12,
                borderRadius: "var(--radius-control)",
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "-0.01em",
                flexShrink: 0,
                transition: "background var(--dur-fast) var(--ease-out-warm), color var(--dur-fast) var(--ease-out-warm), border-color var(--dur-fast) var(--ease-out-warm)",
              }}
              title={selectedCwd ? t("sessionSidebar.newSessionIn", { cwd: selectedCwd }) : t("sessionSidebar.selectProjectFirst")}
              onMouseEnter={(e) => {
                if (!selectedCwd) return;
                e.currentTarget.style.background = "var(--bg-selected)";
                e.currentTarget.style.color = "var(--accent)";
                e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 35%, transparent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = selectedCwd ? "var(--text-muted)" : "var(--text-dim)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <Plus size={12} strokeWidth={2.2} aria-hidden="true" />
              {t("sessionSidebar.new")}
            </button>
            <Tooltip content={t("sessionSidebar.refresh")} side="bottom">
            <button
              aria-label={t("sessionSidebar.refresh")}
              onClick={() => {
                loadSessions(false);
                void loadProjects();
              }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                background: sessionRefreshDone ? "var(--bg-selected)" : "var(--bg-panel)",
                border: `1px solid ${sessionRefreshDone ? "color-mix(in srgb, var(--accent) 40%, transparent)" : "var(--border)"}`,
                color: sessionRefreshDone ? "var(--accent)" : "var(--text-muted)",
                cursor: "pointer",
                width: 32, height: 32,
                borderRadius: "var(--radius-control)",
                padding: 0,
                flexShrink: 0,
                transition: "background 0.3s, color 0.3s, border-color 0.3s",
              }}
              onMouseEnter={(e) => {
                if (sessionRefreshDone) return;
                e.currentTarget.style.background = "var(--bg-selected)";
                e.currentTarget.style.color = "var(--accent)";
                e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 35%, transparent)";
              }}
              onMouseLeave={(e) => {
                if (sessionRefreshDone) return;
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-muted)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
              title={t("sessionSidebar.refresh")}
            >
              {sessionRefreshDone ? (
                <Check size={15} strokeWidth={2.5} aria-hidden="true" />
              ) : (
                <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />
              )}
            </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Projects */}
        <div
          style={{
            flex: explorerOpen && (selectedCwdProp || selectedCwd) ? "1 1 0" : "1 1 auto",
            overflowY: "auto",
            padding: "10px 12px 12px",
            minHeight: 80,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <span
              style={{
                color: "var(--text-muted)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              {t("projects.heading")}
            </span>
            <button
              onClick={() => {
                setAddProjectOpen(true);
                setAddProjectError(null);
              }}
              aria-label={t("projects.add")}
              title={t("projects.addTitle")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 26, height: 26, padding: 0,
                background: "none", border: "none",
                color: "var(--text-dim)", cursor: "pointer",
                borderRadius: "var(--radius-control)",
                transition: "color var(--dur-fast) var(--ease-out-warm), background var(--dur-fast) var(--ease-out-warm)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
            >
              <Plus size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>

          {loading && (
            <div style={{ padding: "10px 4px", color: "var(--text-muted)", fontSize: 12 }}>
              {t("sessionSidebar.loading")}
            </div>
          )}
          {projectsError && (
            <div style={{ padding: "10px 4px", color: "var(--accent)", fontSize: 12 }}>{projectsError}</div>
          )}
          {error && (
            <div style={{ padding: "10px 4px", color: "var(--accent)", fontSize: 12 }}>{error}</div>
          )}
          {!loading && !projectsError && !error && sortedProjects.length === 0 && (
            <div style={{ padding: "10px 4px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
              {t("projects.noProjects")}
            </div>
          )}

          {sortedProjects.map((project) => (
            <ProjectRow
              key={project.path}
              project={project}
              isActive={selectedProject === project.path}
              isExpanded={expandedProjectPaths.has(project.path)}
              activity={projectActivity.get(project.path)}
              tree={buildSessionTree(sessionsByProject.get(project.path) ?? [])}
              selectedSessionId={selectedSessionId}
              runningSessionIds={runningSessionIds}
              unreadSessionIds={unreadSessionIds}
              onActivate={activateProject}
              onToggleExpand={toggleProjectExpanded}
              onRemoveProject={handleRemoveProject}
              removeBusy={removeProjectPath === project.path}
              onSelectSession={handleSelectSessionFromList}
              onRenamed={loadSessions}
              onSessionDeleted={handleSessionDeleted}
              activeWorktreeSwitcher={activeProjectSwitcher}
              activeWorktreeGuide={activeProjectGuide}
            />
          ))}
        </div>

      {/* File Explorer section */}
      {(selectedCwdProp || selectedCwd) && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            flex: explorerOpen ? "1 1 0" : "0 0 auto",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <button
              onClick={() => setExplorerOpen((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: 1,
                padding: "6px 10px",
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                textAlign: "left",
              }}
            >
              <ChevronRight size={12} strokeWidth={1.8} style={{ transform: explorerOpen ? "rotate(90deg)" : "none", transition: "transform var(--dur-fast) var(--ease-out-warm)", flexShrink: 0 }} aria-hidden="true" />
              {t("sessionSidebar.explorer")}
            </button>
            {explorerOpen && (
              <Tooltip content={t("sessionSidebar.uploadFilesTitle")} side="top">
              <button
                onClick={() => fileExplorerRef.current?.openUploadPicker()}
                disabled={explorerUploadBusy}
                title={t("sessionSidebar.uploadFilesTitle")}
                aria-label={t("sessionSidebar.uploadFiles")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 26, height: 26, padding: 0,
                  background: "none",
                  border: "none",
                  color: "var(--text-dim)",
                  cursor: explorerUploadBusy ? "default" : "pointer",
                  borderRadius: "var(--radius-control)",
                  flexShrink: 0,
                  opacity: explorerUploadBusy ? 0.6 : 1,
                  transition: "color 0.3s, background 0.3s",
                }}
                onMouseEnter={(e) => { if (explorerUploadBusy) return; e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { if (explorerUploadBusy) return; e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
              >
                <Upload size={13} strokeWidth={2} aria-hidden="true" />
              </button>
              </Tooltip>
            )}
            <Tooltip content={t("sessionSidebar.refreshExplorer")} side="top">
            <button
              aria-label={t("sessionSidebar.refreshExplorer")}
              onClick={() => {
                if (onExplorerRefresh) onExplorerRefresh();
                else setExplorerKey((k) => k + 1);
              }}
              title={t("sessionSidebar.refreshExplorer")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 26, height: 26, padding: 0, marginRight: 6,
                background: "none",
                border: "none",
                color: explorerRefreshing ? "var(--accent)" : "var(--text-dim)",
                cursor: "pointer",
                borderRadius: "var(--radius-control)",
                flexShrink: 0,
                transition: "color 0.3s, background 0.3s",
              }}
              onMouseEnter={(e) => { if (explorerRefreshing) return; e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { if (explorerRefreshing) return; e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
            >
              {explorerRefreshing ? (
                <RefreshCw size={13} strokeWidth={2} aria-hidden="true" className="icon-spin" />
              ) : (
                <RefreshCw size={13} strokeWidth={2} aria-hidden="true" />
              )}
            </button>
            </Tooltip>
          </div>
          {explorerOpen && (
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
              <FileExplorer
                ref={fileExplorerRef}
                cwd={selectedCwd ?? selectedCwdProp!}
                onOpenFile={onOpenFile ?? (() => {})}
                refreshKey={explorerKey}
                onAtMention={onAtMention}
                onAtMentions={onAtMentions}
                onUploadBusyChange={setExplorerUploadBusy}
                onRefreshDone={onExplorerRefreshDone}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const MAX_PROJECT_SESSIONS = 5;

interface ProjectRowProps {
  project: ManagedProject;
  isActive: boolean;
  isExpanded: boolean;
  activity: { running: number; unread: number } | undefined;
  tree: SessionTreeNode[];
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  onActivate: (path: string) => void;
  onToggleExpand: (path: string) => void;
  onRemoveProject: (path: string) => void;
  removeBusy: boolean;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  activeWorktreeSwitcher?: ReactNode;
  activeWorktreeGuide?: ReactNode;
}

/** One project in the sidebar: a card row matching the session items' visual
 *  language, with the active project's worktree selector directly below and
 *  the project's session tree (capped at MAX_PROJECT_SESSIONS roots, with a
 *  show-more toggle) nested under it when expanded. */
function ProjectRow({
  project,
  isActive,
  isExpanded,
  activity,
  tree,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  onActivate,
  onToggleExpand,
  onRemoveProject,
  removeBusy,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  activeWorktreeSwitcher,
  activeWorktreeGuide,
}: ProjectRowProps) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const label = projectLabel(project.path);
  const hasActivity = Boolean(activity && (activity.running > 0 || activity.unread > 0));
  const hiddenCount = tree.length - MAX_PROJECT_SESSIONS;
  const visibleRoots = hiddenCount > 0 && !showAllSessions
    ? tree.slice(0, MAX_PROJECT_SESSIONS)
    : tree;
  const showActions = hovered || focusWithin;

  return (
    <div style={{ marginBottom: 2 }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocusWithin(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          height: 44,
          margin: "2px 8px",
          padding: "0 4px 0 6px",
          borderRadius: "var(--radius-control)",
          background: isActive ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
          borderLeft: isActive ? "3px solid var(--accent)" : "3px solid transparent",
          transition: "background var(--dur-fast) var(--ease-out-warm), border-color var(--dur-fast) var(--ease-out-warm)",
        }}
      >
        <button
          onClick={() => onToggleExpand(project.path)}
          aria-label={isExpanded ? t("projects.collapseProject", { name: label }) : t("projects.expandProject", { name: label })}
          aria-expanded={isExpanded}
          title={isExpanded ? t("projects.collapseProjectTitle", { path: project.path }) : t("projects.expandProjectTitle", { path: project.path })}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 24, height: 24, padding: 0, flexShrink: 0,
            background: "none", border: "none",
            color: "var(--text-dim)", cursor: "pointer",
            borderRadius: "var(--radius-control)",
            transform: isExpanded ? "rotate(90deg)" : "none",
            transition: "transform var(--dur-fast) var(--ease-out-warm)",
          }}
        >
          <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button
          onClick={() => onActivate(project.path)}
          aria-current={isActive ? "true" : undefined}
          title={project.path}
          style={{
            flex: 1,
            minWidth: 0,
            height: "100%",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0 4px",
            background: "none", border: "none",
            color: isActive ? "var(--text)" : "var(--text-muted)",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span
            className="display-serif"
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              minWidth: 0,
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              lineHeight: 1.4,
            }}
          >
            {label}
          </span>
          {hasActivity && (
            <span aria-label={t("projects.activity", { running: activity?.running ?? 0, unread: activity?.unread ?? 0 })} style={{ display: "flex", gap: 3, flexShrink: 0 }}>
              {(activity?.running ?? 0) > 0 && <span title={t("projects.running")} style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1.5s ease-in-out infinite" }} />}
              {(activity?.unread ?? 0) > 0 && <span title={t("projects.unread")} style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--text-muted)" }} />}
            </span>
          )}
        </button>
        {showActions && (
          <button
            onClick={() => onRemoveProject(project.path)}
            disabled={removeBusy}
            aria-label={t("projects.remove", { name: label })}
            title={t("projects.removeTitle", { name: label })}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26, padding: 0, flexShrink: 0,
              background: "none", border: "none",
              color: "var(--text-dim)", cursor: "pointer",
              borderRadius: "var(--radius-control)",
              opacity: removeBusy ? 0.5 : 1,
              transition: "color var(--dur-fast) var(--ease-out-warm), background var(--dur-fast) var(--ease-out-warm)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "color-mix(in srgb, var(--accent) 8%, transparent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
          >
            <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>

      {isActive && activeWorktreeSwitcher}
      {isActive && activeWorktreeGuide}

      {isExpanded && (
        <div style={{ paddingLeft: 20 }}>
          {visibleRoots.length === 0 ? (
            <div style={{ padding: "8px 12px 10px", color: "var(--text-dim)", fontSize: 11 }}>
              {t("projects.emptyProject")}
            </div>
          ) : (
            <>
              {visibleRoots.map((node) => (
                <SessionTreeItem
                  key={node.session.id}
                  node={node}
                  selectedSessionId={selectedSessionId}
                  runningSessionIds={runningSessionIds}
                  unreadSessionIds={unreadSessionIds}
                  onSelectSession={onSelectSession}
                  onRenamed={onRenamed}
                  onSessionDeleted={onSessionDeleted}
                  depth={0}
                />
              ))}
              {hiddenCount > 0 && (
                <button
                  onClick={() => setShowAllSessions((v) => !v)}
                  aria-expanded={showAllSessions}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    width: "calc(100% - 16px)",
                    margin: "2px 8px",
                    padding: "7px 12px",
                    background: "none",
                    border: "none",
                    color: "var(--text-dim)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11,
                    fontWeight: 500,
                    borderRadius: "var(--radius-control)",
                    transition: "color var(--dur-fast) var(--ease-out-warm), background var(--dur-fast) var(--ease-out-warm)",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
                >
                  <ChevronDown size={11} strokeWidth={1.8} style={{ flexShrink: 0, transform: showAllSessions ? "rotate(180deg)" : "none", transition: "transform var(--dur-fast) var(--ease-out-warm)" }} aria-hidden="true" />
                  {showAllSessions
                    ? t("projects.showLess")
                    : t("projects.showMoreSessions", { count: hiddenCount })}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface ProjectWorktreeSwitcherProps {
  worktreeState: WorktreeState;
  selectedCwd: string | null;
  homeDir: string;
  wtDropdownOpen: boolean;
  setWtDropdownOpen: Dispatch<SetStateAction<boolean>>;
  wtNewOpen: boolean;
  setWtNewOpen: Dispatch<SetStateAction<boolean>>;
  wtNewBranch: string;
  setWtNewBranch: Dispatch<SetStateAction<string>>;
  wtError: string | null;
  setWtError: Dispatch<SetStateAction<string | null>>;
  wtBusy: boolean;
  wtConfirmRemove: string | null;
  setWtConfirmRemove: Dispatch<SetStateAction<string | null>>;
  onSelectWorktree: (path: string) => void;
  onCreateWorktree: () => void;
  onRemoveWorktree: (path: string, force: boolean) => void;
  dropdownRef: RefObject<HTMLDivElement | null>;
  newInputRef: RefObject<HTMLInputElement | null>;
}

/** Worktree switcher rendered directly below the active project's row. All
 *  worktrees of a project share one list, so switching between them keeps the
 *  row mounted instead of flickering while data refetches. */
function ProjectWorktreeSwitcher({
  worktreeState,
  selectedCwd,
  homeDir,
  wtDropdownOpen,
  setWtDropdownOpen,
  wtNewOpen,
  setWtNewOpen,
  wtNewBranch,
  setWtNewBranch,
  wtError,
  setWtError,
  wtBusy,
  wtConfirmRemove,
  setWtConfirmRemove,
  onSelectWorktree,
  onCreateWorktree,
  onRemoveWorktree,
  dropdownRef,
  newInputRef,
}: ProjectWorktreeSwitcherProps) {
  const { t } = useI18n();
  const currentWt = worktreeState.worktrees.find((w) => w.path === selectedCwd)
    ?? worktreeState.worktrees.find((w) => w.isMain);
  return (
    <div ref={dropdownRef} style={{ position: "relative", marginTop: 6 }}>
      <button
        onClick={() => setWtDropdownOpen((v) => !v)}
        title={currentWt ? t("sessionSidebar.switchWorktreeTo", { path: currentWt.path }) : t("sessionSidebar.switchWorktree")}
        style={{
          width: "100%",
          height: 29,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 10px",
          background: "var(--bg-hover)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-control)",
          cursor: "pointer",
          fontSize: 11,
          lineHeight: 1.35,
          color: "var(--text-muted)",
          textAlign: "left",
        }}
      >
        <GitBranch size={12} strokeWidth={2} style={{ flexShrink: 0, color: currentWt && !currentWt.isMain ? "var(--accent)" : "var(--text-dim)" }} aria-hidden="true" />
        <PathLabel
          text={currentWt ? (currentWt.branch ?? displayCwd(currentWt.path, homeDir)) : "…"}
          style={{ flex: 1, fontFamily: "var(--font-mono)", color: "var(--text)" }}
        />
        {worktreeState.worktrees.length > 1 && (
          <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>
            {worktreeState.worktrees.length}
          </span>
        )}
        <ChevronDown size={12} strokeWidth={1.8} style={{ flexShrink: 0, transform: wtDropdownOpen ? "rotate(180deg)" : "none", transition: "transform var(--dur-fast) var(--ease-out-warm)" }} aria-hidden="true" />
      </button>

      <AnimatedDropdown
        open={wtDropdownOpen}
        style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          right: 0,
          zIndex: 100,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-control)",
          boxShadow: "var(--shadow-pop)",
          overflow: "hidden",
        }}
      >
          <div style={{ maxHeight: "min(40vh, 300px)", overflowY: "auto" }}>
            {worktreeState.worktrees.map((wt) => {
              const isCurrent = wt.path === selectedCwd || (wt.isMain && !worktreeState.worktrees.some((w) => w.path === selectedCwd));
              if (wtConfirmRemove === wt.path) {
                return (
                  <div key={wt.path} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid var(--border)", background: "color-mix(in srgb, var(--accent) 6%, transparent)" }}>
                    <span style={{ flex: 1, fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t("sessionSidebar.uncommittedForceRemove")}
                    </span>
                    <button
                      onClick={() => onRemoveWorktree(wt.path, true)}
                      disabled={wtBusy}
                      style={{ padding: "3px 9px", background: "var(--accent-strong)", border: "none", borderRadius: "var(--radius-control)", color: "var(--on-accent)", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                    >
                      {t("sessionSidebar.force")}
                    </button>
                    <button
                      onClick={() => setWtConfirmRemove(null)}
                      style={{ padding: "3px 9px", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
                    >
                      {t("sessionSidebar.cancel")}
                    </button>
                  </div>
                );
              }
              return (
                <div
                  key={wt.path}
                  className="wt-row"
                  style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)" }}
                >
                  <button
                    onClick={() => onSelectWorktree(wt.path)}
                    title={wt.path}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      padding: "8px 10px",
                      background: "var(--bg)",
                      border: "none",
                      color: isCurrent ? "var(--text)" : "var(--text-muted)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {isCurrent ? (
                      <Check size={10} strokeWidth={2} style={{ flexShrink: 0, color: "var(--accent)" }} aria-hidden="true" />
                    ) : (
                      <span style={{ width: 10, flexShrink: 0 }} />
                    )}
                    <PathLabel text={wt.branch ?? displayCwd(wt.path, homeDir)} style={{ flex: 1 }} />
                    {wt.isMain && <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{t("sessionSidebar.mainBadge")}</span>}
                  </button>
                  {!wt.isMain && (
                    <button
                      onClick={() => onRemoveWorktree(wt.path, false)}
                      disabled={wtBusy}
                      title={t("sessionSidebar.removeWorktreeTitle", { path: wt.path })}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: 34, height: 28, padding: 0, marginRight: 4,
                        background: "none", border: "none",
                        color: "var(--text-dim)", cursor: "pointer",
                        borderRadius: "var(--radius-control)", flexShrink: 0,
                        transition: "color var(--dur-fast) var(--ease-out-warm), background var(--dur-fast) var(--ease-out-warm)",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "color-mix(in srgb, var(--accent) 8%, transparent)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
                    >
                      <Trash2 size={12} strokeWidth={2} aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {!wtNewOpen ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setWtNewOpen(true);
                setWtError(null);
                setTimeout(() => newInputRef.current?.focus(), 0);
              }}
              title={t("sessionSidebar.newWorktreeTitle")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                width: "100%",
                padding: "8px 10px",
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 11,
              }}
            >
              <Plus size={12} strokeWidth={1.8} style={{ flexShrink: 0 }} aria-hidden="true" />
              <span>{t("sessionSidebar.newWorktree")}</span>
            </button>
          ) : (
            <div style={{ padding: "6px 8px" }}>
              <input
                ref={newInputRef}
                value={wtNewBranch}
                onChange={(e) => {
                  setWtNewBranch(e.target.value);
                  setWtError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onCreateWorktree();
                  }
                  if (e.key === "Escape") {
                    setWtNewOpen(false);
                    setWtNewBranch("");
                    setWtError(null);
                  }
                }}
                placeholder={t("sessionSidebar.branchNamePlaceholder")}
                style={{
                  width: "100%",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  padding: "5px 8px",
                  border: "1px solid var(--accent)",
                  borderRadius: "var(--radius-control)",
                  outline: "none",
                  background: "var(--bg)",
                  color: "var(--text)",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                <button
                  onClick={onCreateWorktree}
                  disabled={wtBusy || !wtNewBranch.trim()}
                  style={{
                    flex: 1,
                    padding: "4px 0",
                    background: "var(--accent)",
                    border: "none",
                    borderRadius: "var(--radius-control)",
                    color: "var(--on-accent)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: wtBusy || !wtNewBranch.trim() ? "not-allowed" : "pointer",
                    opacity: wtBusy || !wtNewBranch.trim() ? 0.65 : 1,
                  }}
                >
                  {wtBusy ? t("sessionSidebar.creating") : t("sessionSidebar.create")}
                </button>
                <button
                  onClick={() => { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }}
                  style={{
                    flex: 1,
                    padding: "4px 0",
                    background: "var(--bg-hover)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-control)",
                    color: "var(--text-muted)",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  {t("sessionSidebar.cancel")}
                </button>
              </div>
            </div>
          )}
          {wtError && (
            <div style={{
              padding: "5px 10px 8px",
              color: "var(--accent)",
              fontSize: 11,
              lineHeight: 1.35,
              overflowWrap: "anywhere",
            }}>
              {wtError}
            </div>
          )}
      </AnimatedDropdown>
    </div>
  );
}

const SessionTreeItem = memo(function SessionTreeItem({
  node,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  depth,
}: {
  node: SessionTreeNode;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;
  const sessionId = node.session.id;

  // Pre-compute the booleans so SessionItem only sees primitives — its memo
  // check then never re-renders unless this row's flags actually changed.
  const isSelected = sessionId === selectedSessionId;
  const isRunning = runningSessionIds.has(sessionId);
  const isUnread = unreadSessionIds.has(sessionId);

  // Stable callbacks: depend only on primitives / stable parent callbacks so
  // SessionItem's React.memo stays effective across re-renders.
  const handleClick = useCallback(() => {
    onSelectSession(node.session);
  }, [onSelectSession, node.session]);
  const handleDeleted = useCallback((id: string) => {
    onSessionDeleted?.(id);
  }, [onSessionDeleted]);
  const handleToggleCollapse = useCallback(() => {
    setCollapsed((v) => !v);
  }, []);

  return (
    <div>
      <div style={{ position: "relative" }}>
        {/* Indent line for child sessions */}
        {depth > 0 && (
          <div style={{
            position: "absolute",
            left: depth * 12 + 6,
            top: 0, bottom: 0,
            width: 1,
            background: "var(--border)",
            pointerEvents: "none",
          }} />
        )}
        <SessionItem
          session={node.session}
          isSelected={isSelected}
          isRunning={isRunning}
          isUnread={isUnread}
          onClick={handleClick}
          onRenamed={onRenamed}
          onDeleted={handleDeleted}
          depth={depth}
          hasChildren={hasChildren}
          collapsed={collapsed}
          onToggleCollapse={handleToggleCollapse}
        />
      </div>
      {hasChildren && !collapsed && (
        <div>
          {node.children.map((child) => (
            <SessionTreeItem
              key={child.session.id}
              node={child}
              selectedSessionId={selectedSessionId}
              runningSessionIds={runningSessionIds}
              unreadSessionIds={unreadSessionIds}
              onSelectSession={onSelectSession}
              onRenamed={onRenamed}
              onSessionDeleted={onSessionDeleted}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}, (prev, next) => {
  // Deep-changed inputs warrant a re-render; otherwise skip.
  if (prev.node !== next.node) return false;
  if (prev.selectedSessionId !== next.selectedSessionId) {
    // Only re-render if THIS node's selection state flipped.
    const id = prev.node.session.id;
    if ((id === prev.selectedSessionId) !== (id === next.selectedSessionId)) return false;
  }
  if (prev.runningSessionIds !== next.runningSessionIds) {
    const id = prev.node.session.id;
    if (prev.runningSessionIds.has(id) !== next.runningSessionIds.has(id)) return false;
  }
  if (prev.unreadSessionIds !== next.unreadSessionIds) {
    const id = prev.node.session.id;
    if (prev.unreadSessionIds.has(id) !== next.unreadSessionIds.has(id)) return false;
  }
  if (prev.onSelectSession !== next.onSelectSession
    || prev.onRenamed !== next.onRenamed
    || prev.onSessionDeleted !== next.onSessionDeleted) return false;
  return true;
});

function RunningSessionIndicator() {
  const { t } = useI18n();
  const reducedMotion = usePrefersReducedMotion();
  return (
    <span
      title={t("sessionSidebar.agentRunning")}
      aria-label={t("sessionSidebar.agentRunningAria")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <g>
          <path
            d="M21 12a9 9 0 1 1-3.8-7.4"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          {!reducedMotion && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 12 12"
              to="360 12 12"
              dur="0.9s"
              repeatCount="indefinite"
            />
          )}
        </g>
      </svg>
    </span>
  );
}

function UnreadSessionIndicator() {
  const { t } = useI18n();
  const reducedMotion = usePrefersReducedMotion();
  return (
    <span
      title={t("sessionSidebar.newActivity")}
      aria-label={t("sessionSidebar.newSessionActivity")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <circle cx="7" cy="7" r="2.5" fill="currentColor" />
        {!reducedMotion && (
          <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" opacity="0.32">
            <animate attributeName="r" values="3;6;3" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.32;0;0.32" dur="1.6s" repeatCount="indefinite" />
          </circle>
        )}
      </svg>
    </span>
  );
}

const SessionItem = memo(function SessionItem({
  session,
  isSelected,
  isRunning,
  isUnread,
  onClick,
  onRenamed,
  onDeleted,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
}: {
  session: SessionInfo;
  isSelected: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  // Mirrors :focus-within so the hover-only action cluster is reachable by keyboard.
  const [focusWithin, setFocusWithin] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const contentButtonRef = useRef<HTMLButtonElement>(null);

  const title = session.name || session.firstMessage.slice(0, 50) || session.id.slice(0, 12);

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(session.name ?? "");
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [session.name]);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    if (name === (session.name ?? "")) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRenamed?.();
    } catch {
      // ignore
    }
  }, [renameValue, session.id, session.name, onRenamed]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(true);
  }, []);

  const handleArchiveClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmArchive(true);
  }, []);

  const handleArchiveConfirm = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmArchive(false);
    setDeleting(true);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}/archive`, { method: "POST" });
      if (!response.ok) throw new Error("Session archive failed");
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
    }
  }, [session.id, onDeleted]);

  const handleArchiveCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmArchive(false);
    requestAnimationFrame(() => contentButtonRef.current?.focus());
  }, []);

  const handleDeleteConfirm = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
    }
  }, [session.id, onDeleted]);

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
    requestAnimationFrame(() => contentButtonRef.current?.focus());
  }, []);

  // Fixed-height outer wrapper — content swaps in place so the list never reflows
  const ITEM_HEIGHT = 40;

  return (
    <div
      onClick={confirmDelete || renaming ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      onFocus={() => setFocusWithin(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
      }}
      onKeyDown={(e) => {
        if (confirmDelete && e.key === "Escape") {
          e.stopPropagation();
          setConfirmDelete(false);
          requestAnimationFrame(() => contentButtonRef.current?.focus());
        }
      }}
      style={{
        height: ITEM_HEIGHT,
        display: "flex",
        alignItems: "center",
        paddingLeft: depth > 0 ? depth * 12 + 12 : 12,
        paddingRight: 8,
        position: "relative",
        cursor: confirmDelete || renaming ? "default" : "pointer",
        background: confirmDelete
          ? "color-mix(in srgb, var(--accent) 6%, transparent)"
          : isSelected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        borderLeft: confirmDelete
          ? "3px solid var(--accent)"
          : isSelected ? "3px solid var(--accent)" : "3px solid transparent",
        transition: "background var(--dur-fast) var(--ease-out-warm), border-color var(--dur-fast) var(--ease-out-warm), opacity var(--dur-fast) var(--ease-out-warm)",
        opacity: deleting ? 0.5 : 1,
        gap: 6,
        overflow: "hidden",
        margin: "2px 8px",
        width: "calc(100% - 16px)",
        borderRadius: "var(--radius-control)",
      }}
    >
      {confirmArchive ? (
        /* ── Archive confirmation: same height, two flat buttons ── */
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("sessionSidebar.archiveConfirm", { title: title.length > 22 ? `${title.slice(0, 22)}…` : title })}
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button
              onClick={handleArchiveConfirm}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                height: 30, padding: "0 11px",
                background: "var(--accent-strong)", border: "none",
                borderRadius: "var(--radius-control)", color: "var(--on-accent)",
                cursor: "pointer", fontSize: 12, fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              <Archive size={12} strokeWidth={2} aria-hidden="true" />
              {t("sessionSidebar.archive")}
            </button>
            <button
              onClick={handleArchiveCancel}
              autoFocus
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: 30, padding: "0 11px",
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: "var(--radius-control)", color: "var(--text-muted)",
                cursor: "pointer", fontSize: 12, fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              {t("sessionSidebar.cancel")}
            </button>
          </div>
        </>
      ) : confirmDelete ? (
        /* ── Delete confirmation: same height, two flat buttons ── */
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("sessionSidebar.deleteConfirm", { title: title.length > 22 ? `${title.slice(0, 22)}…` : title })}
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button
              onClick={handleDeleteConfirm}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                height: 30, padding: "0 11px",
                background: "var(--accent-strong)", border: "none",
                borderRadius: "var(--radius-control)", color: "var(--on-accent)",
                cursor: "pointer", fontSize: 12, fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              <Trash2 size={12} strokeWidth={2} aria-hidden="true" />
              {t("sessionSidebar.delete")}
            </button>
            <button
              onClick={handleDeleteCancel}
              autoFocus
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: 30, padding: "0 11px",
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: "var(--radius-control)", color: "var(--text-muted)",
                cursor: "pointer", fontSize: 12, fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              {t("sessionSidebar.cancel")}
            </button>
          </div>
        </>
      ) : renaming ? (
        /* ── Rename: input fills the same row ── */
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          autoFocus
          style={{
            flex: 1,
            fontSize: 12,
            padding: "5px 8px",
            border: "1px solid var(--accent)",
            borderRadius: "var(--radius-control)",
            outline: "none",
            background: "var(--bg)",
            color: "var(--text)",
            height: 30,
          }}
        />
      ) : (
        /* ── Normal view ── */
        <>
          {/* Fork indicator for child sessions */}
          {depth > 0 && (
            <GitBranch size={11} strokeWidth={2} style={{ flexShrink: 0, color: "var(--text-dim)" }} aria-hidden="true" />
          )}
          <button
            ref={contentButtonRef}
            type="button"
            className="session-item-button"
            aria-current={isSelected ? "true" : undefined}
            onKeyDown={(e) => {
              if (e.key === "Delete") {
                e.preventDefault();
                setConfirmDelete(true);
              }
            }}
            style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}
          >
            <span
              className="display-serif"
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
                fontSize: 13,
                fontWeight: isSelected ? 600 : 500,
                lineHeight: 1.4,
                color: "var(--text)",
              }}
              title={title}
            >
              {title}
            </span>
          </button>
          {session.worktreeBranch && (
            <span
              title={t("sessionSidebar.worktreeTitle", { path: session.cwd })}
              style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--accent)", fontSize: 10, flexShrink: 0, maxWidth: 88, overflow: "hidden" }}
            >
              <GitBranch size={10} strokeWidth={2.4} style={{ flexShrink: 0 }} aria-hidden="true" />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.worktreeBranch}</span>
            </span>
          )}
          {isRunning ? <RunningSessionIndicator /> : isUnread ? <UnreadSessionIndicator /> : null}

          {/* Collapse toggle — always visible when has children */}
          {hasChildren && (
            <button
              className="session-item-icon-button"
              onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
              title={collapsed ? t("sessionSidebar.expandForks") : t("sessionSidebar.collapseForks")}
              aria-label={collapsed ? t("sessionSidebar.expandForks") : t("sessionSidebar.collapseForks")}
              aria-expanded={!collapsed}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 20, height: 20, padding: 0, flexShrink: 0,
                background: "none", border: "none",
                color: "var(--text-dim)", cursor: "pointer",
                transform: collapsed ? "rotate(-90deg)" : "none",
                transition: "transform var(--dur-fast) var(--ease-out-warm)",
              }}
            >
              <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" />
            </button>
          )}

          {/* Action buttons — overlaid on the right with a fade so the title
              never reflows; shown on hover or keyboard focus within the row */}
          {(hovered || focusWithin) && (
            <div
              style={{
                position: "absolute",
                right: 8,
                top: 0,
                bottom: 0,
                display: "flex",
                alignItems: "center",
                gap: 2,
                paddingLeft: 16,
                background: "linear-gradient(90deg, transparent, var(--bg-panel) 16px)",
              }}
            >
              <Tooltip content={hasChildren ? t("sessionSidebar.archiveLeafOnly") : t("sessionSidebar.archive")} side="top">
              <button
                className="session-item-icon-button"
                onClick={handleArchiveClick}
                disabled={hasChildren}
                title={hasChildren ? t("sessionSidebar.archiveLeafOnly") : t("sessionSidebar.archive")}
                aria-label={hasChildren ? t("sessionSidebar.archiveLeafOnly") : t("sessionSidebar.archive")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 28, height: 28, padding: 0,
                  background: "var(--bg-hover)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius-control)", color: "var(--text-muted)",
                  cursor: hasChildren ? "not-allowed" : "pointer", flexShrink: 0,
                  opacity: hasChildren ? 0.45 : 1,
                  transition: "background var(--dur-fast) var(--ease-out-warm), color var(--dur-fast) var(--ease-out-warm), border-color var(--dur-fast) var(--ease-out-warm)",
                }}
                onMouseEnter={(e) => {
                  if (hasChildren) return;
                  e.currentTarget.style.background = "var(--bg-selected)";
                  e.currentTarget.style.color = "var(--accent)";
                  e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 35%, transparent)";
                }}
                onMouseLeave={(e) => {
                  if (hasChildren) return;
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <Archive size={14} strokeWidth={2} aria-hidden="true" />
              </button>
              </Tooltip>
              <Tooltip content={t("sessionSidebar.rename")} side="top">
              <button
                className="session-item-icon-button"
                onClick={startRename}
                title={t("sessionSidebar.rename")}
                aria-label={t("sessionSidebar.rename")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 28, height: 28, padding: 0,
                  background: "var(--bg-hover)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius-control)", color: "var(--text-muted)",
                  cursor: "pointer", flexShrink: 0,
                  transition: "background var(--dur-fast) var(--ease-out-warm), color var(--dur-fast) var(--ease-out-warm), border-color var(--dur-fast) var(--ease-out-warm)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-selected)";
                  e.currentTarget.style.color = "var(--accent)";
                  e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 35%, transparent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <Pencil size={14} strokeWidth={2} aria-hidden="true" />
              </button>
              </Tooltip>
              <Tooltip content={t("sessionSidebar.delete")} side="top">
              <button
                className="session-item-icon-button"
                onClick={handleDeleteClick}
                title={t("sessionSidebar.delete")}
                aria-label={t("sessionSidebar.delete")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 28, height: 28, padding: 0,
                  background: "var(--bg-hover)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius-control)", color: "var(--text-muted)",
                  cursor: "pointer", flexShrink: 0,
                  transition: "background var(--dur-fast) var(--ease-out-warm), color var(--dur-fast) var(--ease-out-warm), border-color var(--dur-fast) var(--ease-out-warm)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "color-mix(in srgb, var(--accent) 8%, transparent)";
                  e.currentTarget.style.color = "var(--accent)";
                  e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 35%, transparent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
              </button>
              </Tooltip>
            </div>
          )}
        </>
      )}
    </div>
  );
});
