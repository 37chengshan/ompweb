# ompweb

[English](./README.md) | [简体中文](./README.zh-CN.md) | [日本語](./README.ja.md)

Community: [Join the OMPWEB Discord](https://discord.gg/evqgGzRfM5)

Local web UI for the [oh-my-pi (omp) coding agent](https://github.com/can1357/oh-my-pi). ompweb reads your local omp session files and gives you a browser workspace for session browsing, real-time chat, model configuration, skill management, and project file preview.

![ompweb — live session demo](docs/demo.gif)

<details>
<summary>Screenshots (light / dark)</summary>

![ompweb — light theme](docs/screenshot-light.png)

![ompweb — dark theme](docs/screenshot-dark.png)

</details>

## 🌟 Enhancements & Optimizations over Upstream (相比上游仓库的优化与增强)

This repository ([37chengshan/ompweb](https://github.com/37chengshan/ompweb)) is a feature-rich, hardened fork of [kahme247/ompweb](https://github.com/kahme247/ompweb). Based on actual code implementations, the following key features, architectural upgrades, and performance optimizations have been added:

### 1. 🖥️ Interactive Web Terminal (内置交互式终端)
- **Real PTY Shell Integration (`app/api/terminal/route.ts`, `components/EmbeddedTerminal.tsx`)**: Spawns true pseudo-terminals (`python3 -c "import pty; pty.spawn(...)"`) with ANSI color decoding, bidirectional SSE streaming, serialized inputs, and dynamic window resize (`cols`/`rows`).
- **Dockable Bottom Panel**: Run Git commands, build scripts, tests, and CLI tools directly within ompweb without leaving the browser. Includes auto session reaping and bounded output ring buffers.

### 2. 📂 Native File Manager Integration & Workspace Ordering (文件管理与工作区排序)
- **Always-Visible Reveal Action (`components/FileExplorer.tsx`, `app/api/files/open/route.ts`)**: Permanent "Reveal in Finder / Explorer / File Manager" quick-actions on workspace headers and file tree nodes (not hover-gated) with cross-platform support (macOS `open`, Windows `explorer.exe`, Linux `xdg-open`).
- **Workspace Aliases & Custom Ordering (`lib/project-registry.ts`, `lib/project-ordering.ts`)**: Rename workspace display labels (aliases) and customize project sidebar ordering persistently without mutating repository paths on disk.

### 3. 🎨 Visual Theme Studio & Motion Controls (主题工作室与动效偏好)
- **Theme Studio (`components/ThemeStudio.tsx`, `hooks/useTheme.ts`)**: Live preview and customize paper/ember design tokens with WCAG AA contrast verification, instant light/dark/system cycling, and custom color accents.
- **Motion Accessibility (`hooks/useMotionPrefs.ts`)**: OS `prefers-reduced-motion` integration that instantly disables heavy SVG SMIL animations and replaces smooth-scrolling with instant jumps for users sensitive to motion.

### 4. 🧭 Plan Mode Surface & History Traceability (计划看板与压缩前历史追溯)
- **Interactive Plan Panel (`components/PlanPanel.tsx`, `lib/plan-reader.ts`)**: Live plan document rendering from `<session>/local/*-plan.md`, one-click plan execution, and a dedicated critique/feedback modal (`onRejectPlan`).
- **Pre-Compaction History Browsing (`lib/session-reader.ts`)**: Toggle and inspect full pre-compaction message history without polluting the active agent context.

### 5. ⚡ Frontend Rendering & Viewport Safety (前端渲染极致优化)
- **Streaming Markdown AST Bypass (`components/MarkdownBody.tsx`)**: Bypasses expensive math regex scans (`normalizeDisplayMath`) and dynamic KaTeX imports during streaming, compiling AST only once on message commit for a smooth 60fps experience.
- **LRU Memory Caches (`lib/markdown.ts`, `lib/patch.ts`)**: 200-slot LRU cache for display math normalization and 20-slot LRU cache for unified diff parsing (`parseUnifiedPatch`).
- **DOM Explosion Protection (`components/MessageView.tsx`)**: 800-row limit (`MAX_ROWS = 800`) on Git diff views and 100KB safety caps on thinking/tool outputs.
- **Component Memoization (`components/PlanPanel.tsx`, `components/MessageView.tsx`)**: `React.memo` wrappers prevent cascading re-renders during active streaming.

### 6. 🛡️ Backend Node.js, RPC & File I/O Hardening (后端 RPC 内存安全加固)
- **Git ProjectRoot Dedup & 5-minute Cache (`lib/worktree.ts`)**: `__piProjectPendingCache` coalesces concurrent `resolveProject` calls into a single Promise and caches results for 5 minutes.
- **SSE Socket & Memory Leak Prevention (`app/api/agent/[id]/events/route.ts`, `lib/rpc-manager.ts`)**: Emits `session_destroyed` upon session termination to immediately close SSE streams and unregister listeners.
- **Child Process Dispose Failsafe (`lib/omp/rpc-process.ts`)**: `Promise.race` timeout fallback prevents hanging promises on un-reaped processes; `crlfDelay: Infinity` standardizes NDJSON parsing.
- **Context Payload Shrinking (`lib/session-reader.ts`, `lib/types.ts`)**: Completely strips deferred `thinking` fields from JSON payloads rather than sending empty strings.

### 7. ⚙️ Redesigned MCP Manager & Built-in Agent MCP (MCP 管理器重构与 Agent MCP 集成)
- **Dual-Mode Visual Form Editor (`components/McpConfig.tsx`)**: Form-based editing (Transport, Command, Args, URL, Enabled switch) + JSON mode with quick templates (`Python stdio`, `NPX stdio`, `Remote HTTP`) and project/global configuration support.
- **Categorized Accordion & Filter (`components/McpConfig.tsx`)**: Accordion grouping with real-time search for multi-client discovered MCP servers.
- **Built-in Agent MCP Integration (`vendor/agent-mcp/`)**: Vendored `agent-mcp` (v3.0.0) multi-agent orchestration tools with SQLite tuning (`PRAGMA temp_store=MEMORY`, autocommit mode) and lock-free SSE broadcaster queues.

## Requirements

- [omp](https://github.com/can1357/oh-my-pi) installed and on your `PATH` (or point `OMP_WEB_OMP_BIN` at the binary)
- Node.js 22.19.0 (`nvm use`; `node --version`)

## Quick Start

**Run without installing:**

```bash
npx @kahme247/ompweb@latest
```

**Or install globally:**

```bash
npm install -g @kahme247/ompweb
ompweb
```

Then open [http://127.0.0.1:30177](http://127.0.0.1:30177). The CLI will try to open the browser automatically after the server is ready. ompweb listens on `127.0.0.1` by default.

**Options:**

```bash
ompweb --port 8080              # custom port
ompweb --hostname 0.0.0.0       # expose on a trusted network
ompweb -p 8080 -H 0.0.0.0       # combine options
ompweb --no-open                # do not open the browser automatically
ompweb --password "a-long-random-password" # password-only sign-in without POSIX inline-env syntax

PORT=8080 ompweb                # environment variable is also supported
OMP_WEB_HOSTNAME=0.0.0.0 ompweb # explicit network exposure
OMP_WEB_PASSWORD='a-long-random-password' ompweb # env-variable form (POSIX: inline or exported)
OMP_WEB_NO_OPEN=1 ompweb        # useful when running as a background service

# Windows (PowerShell / CMD)
# $env:OMP_WEB_PASSWORD="a-long-random-password"; ompweb
# or
# ompweb --password "a-long-random-password"
```

Set `OMP_WEB_PASSWORD` (or pass `--password`) to protect the interface and every API endpoint with a themed, password-only sign-in screen. A successful sign-in creates an HTTP-only signed session cookie for 30 days; changing the configured password invalidates existing sessions. Leaving the variable unset disables authentication. Remote use still requires HTTPS through a trusted reverse proxy or VPN so the password and session cookie cannot be intercepted. On Windows the env-variable syntax is `$env:OMP_WEB_PASSWORD="..."`; `ompweb --password "..."` works in every shell without that extra step.

### Security and troubleshooting

- The server binds to `127.0.0.1` by default. A non-loopback hostname is an explicit opt-in and should only be used behind a trusted network boundary; ompweb is not safe to expose publicly.
- File APIs are allow-listed to the selected workspace, its valid Git worktrees, session-referenced directories, and explicitly selected roots. Paths are canonicalized to reject traversal and symlink escapes.
- `omp` is resolved from `OMP_WEB_OMP_BIN` first, then `PATH`. If live chat cannot start, run `omp --version` in the same terminal or set `OMP_WEB_OMP_BIN` to the executable's absolute path.
- Session history remains native OMP JSONL. OMP owns live-session writes; ompweb reads the files directly and only performs explicit title, archive, and delete maintenance when it is not racing a live OMP write.
- Session archive uses OMP's native `archive/sessions/<cwd>/<file>.jsonl.gz` layout and moves sibling artifacts with the transcript; the original JSONL bytes are preserved inside the gzip.

## Features

- **Pick work back up**: browse previous omp conversations by project without digging through terminal history or session paths.
- **Try different directions safely**: continue from an earlier message (in-session branches with a branch navigator) or fork a session into a separate route.
- **Keep the sidebar tidy**: archive an inactive session without deleting its native transcript, or delete it explicitly when it is no longer needed.
- **Work across branches**: switch Git worktrees from the sidebar so new sessions and the Explorer follow the checkout you choose.
- **Chat beside the project**: browse files on the left and preview source, docs, images, audio, and PDFs on the right while the agent works.
- **Watch subagents and plans live**: composer-attached panels show the todo plan and running subagents with per-subagent telemetry; click a chip for the full subagent transcript.
- **See session state clearly**: context usage, cost, tokens-per-second (reported by omp itself), compaction state and method (with before → after token counts on compaction cards), and system prompt details are visible from the top bar and transcript.
- **Preview markdown faithfully**: YAML frontmatter renders in a summary card (title + key/value rows), math fences stay aligned inside lists, and CJK ranges like `5~7U` are no longer mangled (GFM now requires `~~` for strikethrough).
- **Pick projects naturally on Windows**: a drive picker at the filesystem root and a case-folded, symlink-aware project identity keep the sidebar stable across drives and worktrees.
- **Configure less from the terminal**: manage models, login/API keys, model tests, task agents, native OMP controls (advisor, approval, Bash policy, thinking, compaction, memory, auto-learn, retry/fallback), skills (search, install, update checks), plugins, and project MCP servers from the web UI.
- **MCP management in Settings**: a dedicated MCP tab lists installed project servers with status (enabled / disabled / invalid), supports add/edit/rename/validate/remove, and surfaces configuration failures as corner toasts.
- **Slash commands that travel**: `/goal`, `/plan`, `/review`, `/fix`, `/test`, `/explain`, `/simplify`, `/commit`, and `/advisor` expand into well-structured prompts; omp's own commands (skills, `/compact`, …) appear via `available_commands_update`.
- **Keep OMP current**: check the installed runtime version, update it, and restart active sessions from Settings when needed.
- **Stay informed**: opt into browser notifications when an agent finishes, play a completion sound, and check installed skills for updates.
- **Jump anywhere with ⌘K**: a command palette (⌘K / Ctrl+K) for switching sessions, starting new ones, and toggling the theme.
- **Warm, paper-like design**: light and dark themes with serif display type and WCAG AA-verified contrast, built on a token-driven UI kit (Base UI primitives, cmdk, lucide icons).

## Configuration

| Variable | Meaning |
| --- | --- |
| `PORT` | Server port (default `30177`; `-p/--port` wins) |
| `OMP_WEB_HOSTNAME` | Bind hostname (default `127.0.0.1`; `-H/--hostname` wins) |
| `OMP_WEB_PASSWORD` / `--password` | Password for the sign-in screen; `--password` works in every shell (PowerShell/CMD) without ` $env:` syntax |
| `OMP_WEB_NO_OPEN` | Set to `1`/`true` to skip auto-opening the browser |
| `OMP_WEB_OMP_BIN` | Absolute path to the `omp` binary when it is not on `PATH` |
| `PI_CODING_AGENT_DIR` | Point at another omp agent directory (default `~/.omp/agent`) |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | Standard proxy variables for server-side requests |

## Architecture

ompweb is a Node-hosted Next.js app that drives your installed `omp` binary — it does not embed the agent:
- **Live sessions**: spawns `omp --mode rpc-ui` (NDJSON over stdio), one child process per active session, so the agent version is always exactly what you have installed. It negotiates RPC v2 when the installed OMP advertises it, uses bounded chunk reassembly for large frames, and falls back to v1 for older versions. Host env (`PORT`, `NEXT_*`, `NODE_ENV`) is stripped before spawn, and shutdown is graceful on both POSIX (process-group) and Windows (`taskkill /t`).
- **Live state and telemetry**: context usage, queue depth, compaction state, and tokens-per-second are polled from omp's `get_state` RPC and surfaced in the top bar and transcript; compaction cards show the maintenance method and before → after token counts. Subagent transcripts persist beside the parent session's artifacts and are recovered from disk so past runs still show their rosters.
- **Session browsing**: reads omp's session files (`~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`) directly; title, archive, and delete are narrow native-file maintenance operations guarded against live OMP writes. Projects are grouped by a stable `projectKey` (Windows case-folded, symlink-resolved) so the sidebar doesn't jump between drives or worktrees.
- **Models and auth**: RPC commands against the omp child process with strict payload validation (unknown-shape guards, safe fallbacks); the Models panel edits `models.yml` in the omp agent directory, dropping blank placeholder rows and rejecting ambiguous `enabledModels` entries.
- **Native settings**: the General/MCP settings panels read and write the allow-listed subset of `~/.omp/agent/config.yml` (or `config.yaml` fallback), preserving unrelated keys and comments. Changes apply to new and restarted sessions.
- **Skills and plugins**: scans omp's skill directories (`~/.omp/agent/skills`, project `.omp/skills`, and compat dirs) and shells out to `omp plugin` for plugin management.
- **MCP servers**: project servers are managed through OMP's native locations (`.omp/mcp.json`, then compatibility files) at the git top level, validated against the stdio/http/sse schema and written atomically.
- **File access**: file browsing and preview are scoped to the selected project directory and working directories that appear in sessions; paths are canonicalized via a single `isWindowsAbsolutePath`/`samePath` helper and symlink escapes are rejected after `realpath` resolution. On Windows the directory picker offers a drive list at the root.
- **Forks vs in-session branches**: Fork creates a new `.jsonl` file. "Edit from here" creates another branch inside the same session file.

## Development

```bash
npm install
npm run dev
```

The local dev server runs at [http://127.0.0.1:30178](http://127.0.0.1:30178).

Common checks:

```bash
npm run typecheck      # type check
npm run lint           # ESLint (zero warnings enforced)
npm test               # run test suite
npm run build          # production build
```

Avoid running `next build` / `npm run build` during local development. It writes to `.next/` and can interfere with the dev server; leave builds for release work.

## Internationalization

ompweb supports English, Simplified Chinese (简体中文), and Japanese (日本語) with translated UI strings across all three languages. The language is auto-detected from `navigator.language` and can be switched at runtime via the language menu in the top bar. The choice persists across sessions.

- Dictionaries: `lib/i18n/locales/{en,zh-CN,ja}.json`
- Framework: `lib/i18n/index.tsx` — a lightweight store built on `useSyncExternalStore` with `{var}` interpolation and plural support (`.one`/`.other`)
- API error messages are translated via stable error codes (`errors.<code>`) looked up client-side

## Quality

- **Accessibility**: WCAG AA compliant — Lighthouse a11y score 100/100, keyboard navigation throughout, focus-visible rings, ARIA roles
- **Performance**: memoized list components, RAF-gated scroll/mouse handlers, debounced search, streaming JSONL reader, ETag-cached session listing
- **Resilience**: graceful shutdown of spawned omp processes (process-group kill), error boundaries, atomic session file rewrites
- **Tests**: a focused suite covering session parsing, RPC frame chunking, subagent history, markdown rendering, message display, native settings, and MCP configuration — run with `npm test`

## Credits

ompweb is a fork of [agegr/pi-web](https://github.com/agegr/pi-web) (MIT), the web UI for the [earendil/pi-mono](https://github.com/earendil-works/pi) pi coding agent, adapted for [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi).

## License

MIT
