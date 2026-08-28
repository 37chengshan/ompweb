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

This repository ([37chengshan/ompweb](https://github.com/37chengshan/ompweb)) is a feature-rich, hardened fork of [kahme247/ompweb](https://github.com/kahme247/ompweb). Verified directly against the codebase, the following key features, architectural upgrades, and performance optimizations have been implemented:

### 1. 🖥️ Interactive Web PTY Terminal (内置交互式 Web 终端)
- **Real PTY Shell Allocation (`lib/terminal-session-manager.ts`, `components/TerminalPanel.tsx`, `app/api/terminal/*`)**: Spawns true pseudo-terminals (`python3 -c "import pty,sys; pty.spawn(...)" /bin/zsh -i` on macOS, `script -qfc` on Linux) supporting full ANSI 256/TrueColor color decoding, real interactive line editing, cursor navigation, and live zsh/bash echo.
- **Session Lifecycle & Resource Bounds**: Automatically reaps idle shell processes (30min TTL) and enforces an 8-session global cap to prevent lingering orphan processes.
- **Buffer Safety & Ordered Keystrokes**: History output buffer is bounded by total byte size (`MAX_HISTORY_BYTES = 1MB`) rather than line count. Keystrokes are serialized through a FIFO queue with a 5s AbortSignal timeout to eliminate out-of-order execution during rapid typing.

### 2. 📂 Native File Manager Integration (系统文件管理器一键定位)
- **Always-Visible Reveal Action (`app/api/reveal/route.ts`, `components/FileExplorer.tsx`, `components/SessionSidebar.tsx`)**: Permanent "Reveal in Finder / Explorer / File Manager" quick-actions on workspace headers and file tree nodes (not hover-gated) with cross-platform support (macOS `open <dir>` / `open -R <file>`, Windows `explorer /select,`, Linux `xdg-open`).
- **Security & Timeout Protection**: Paths are strictly validated against `getAllowedFileRoots()` and execution is capped at 8 seconds (`timeout: 8000`) so desktop file manager hangs never freeze the browser.

### 3. 🎨 Visual Theme Studio & Motion Controls (主题工作室与动效偏好)
- **Theme Studio (`components/ThemePicker.tsx`, `hooks/useTheme.ts`)**: 18+ fine-tuned preset themes (Classic Paper, Ember Dark, Nord, Oatmeal, Matcha, OLED True Black, Sepia, Dracula, Pine, Navy, plus 6 fluid animated flow themes: `aurora-flow`, `dawn-flow`, `cosmic-flow`, `ocean-flow`, `sakura-flow`, `bamboo-flow`) and a full custom color palette picker.
- **Typography & Motion Accessibility (`hooks/useTypography.ts`, `hooks/useMotionPrefs.ts`)**: Custom font families, font scale multipliers, and line-height controls. Fully integrates with OS `prefers-reduced-motion` to instantly disable heavy animations and replace smooth scrolls with instant jumps.

### 4. 🧭 Plan Mode Kanban & History Traceability (计划执行看板与历史追溯)
- **Interactive Plan Panel (`components/PlanPanel.tsx`, `lib/plan-reader.ts`, `app/api/sessions/[id]/plan/route.ts`)**: Live plan document rendering from `<session>/local/*-plan.md` with safe 256KB UTF-8 chunk reading (`StringDecoder`) that prevents loading oversized files into Node memory.
- **Session Switch Safety**: Automatically resets `planInfo` on session navigation so failed plan fetches can never leak previous session plans.

### 5. ⚡ Frontend Rendering Performance & Memory Safety (前端渲染极致优化)
- **Streaming Markdown AST Bypass (`components/MarkdownBody.tsx`)**: Skips heavy `normalizeDisplayMath` regex scans and dynamic KaTeX imports during active token streaming, compiling the full AST only once on message commit.
- **LRU Math Delimiter Normalizer (`lib/markdown.ts`)**: 200-slot LRU cache (`NORMALIZE_CACHE_MAX = 200`) for display math normalization ensures committed messages render in $O(1)$ without re-running regex passes.
- **Granular `MessageView` Memoization (`components/MessageView.tsx`)**: Custom comparator (`haveSameRelevantToolResults`) ensures incoming tool results only re-render the specific message holding that `toolCallId`, avoiding global re-renders of the entire message list.
- **Large Markdown Safety Collapse (`components/MessageView.tsx`)**: Messages exceeding 100,000 characters automatically collapse into a lightweight virtualized raw text view (`SafeMarkdownBody`) to prevent React AST DOM explosion.
- **LRU Unified Patch Cache (`lib/patch.ts`)**: 20-slot LRU cache for diff parsing avoids duplicate regex and line parsing on re-renders.
- **Adaptive TPS Polling Backoff (`hooks/useAgentSession.ts`)**: Dynamically backs off `tokensPerSecond` polling from 2s to 4s during model thinking or tool execution, snapping back to 2s immediately when tokens stream.

### 6. 🛡️ Backend Concurrency, RPC & File I/O Hardening (后端并发与 RPC 内存安全)
- **Git Worktree In-Flight Promise Dedup (`lib/worktree.ts`)**: `__piProjectPendingCache` coalesces concurrent `resolveProject` calls for identical directories into a single Promise and caches results with a 5-minute TTL.
- **Session Loader Concurrency Cap & Cache (`lib/session-reader.ts`)**: `loadAllSessions` restricts concurrent Git processes with `CONCURRENCY = 6`. File parses are memoized with a 32-slot LRU cache (`loadSessionEntriesCached`) keyed on `(size, mtimeMs)`.
- **Task Tool Telemetry Truncation (`lib/session-reader.ts`)**: `keepTaskToolResultDetails` bounds long string fields to 240 characters and 50 rows, eliminating multi-megabyte JSON payload bloat in session histories.
- **Child Process Dispose Failsafe (`lib/omp/rpc-process.ts`)**: Failsafe race timer fallback in `RpcProcess.dispose()` prevents un-reaped processes from hanging server teardown.
- **Atomic MCP Configuration (`lib/omp/mcp-config.ts`)**: Temp file write-and-rename wrapped in `try...finally` to guarantee orphan `.tmp-*` files are cleaned up on error; adds user-level MCP configuration support (`~/.omp/agent/mcp.json`).

### 7. ⚙️ Redesigned MCP Manager & Built-in Agent MCP (MCP 管理器重构与 Agent MCP 集成)
- **Visual Form & Template Editor (`components/McpConfig.tsx`)**: Dual-mode editor (Visual Form / Raw JSON) with quick templates (`Python stdio`, `NPX stdio`, `Remote HTTP`, `Brave Search`, `PostgreSQL`, `GitHub`, `Fetch`, `Filesystem`) and workspace/user scope switching.
- **Categorized Multi-Source Accordion (`components/McpConfig.tsx`)**: Collapsible accordion grouping with real-time fuzzy search across 50+ auto-discovered MCP servers.
- **Built-in Agent MCP Multi-Agent Orchestrator (`vendor/agent-mcp/`, `.omp/agents/`)**: Native Python multi-agent coordination daemon supporting 11+ Agent CLIs (OMP, Claude, Codex, Copilot, OpenCode, Pi, Grok, Kimi, ZCode, etc.), SQLite WAL mode with memory temp storage (`PRAGMA temp_store=MEMORY`), exponential backoff in `wait_agent` polling (0.1s to 2.0s), and bundled specialized agent system prompts (`designer`, `librarian`, `reviewer`, `scout`, `security-reviewer`, `sonic`, `task`).

## Requirements

- [omp](https://github.com/can1357/oh-my-pi) installed and on your `PATH` (or point `OMP_WEB_OMP_BIN` at the binary)
- Node.js >= 22.19.0 (`node --version`)

## Quick Start

**Run without installing:**

```bash
npx @37chengshan/ompweb@latest
```

**Or install globally:**

```bash
npm install -g @37chengshan/ompweb
ompweb
```

> **Mirror registries (e.g. npmmirror) may lag or 404 for newly published packages.** If install fails with `E404`, point npm at the official registry:
>
> ```bash
> npm install -g @37chengshan/ompweb --registry=https://registry.npmjs.org
> ```
>
> For `npx` on macOS/Linux: `npm_config_registry=https://registry.npmjs.org npx @37chengshan/ompweb@latest`; on Windows PowerShell: `$env:npm_config_registry="https://registry.npmjs.org"; npx @37chengshan/ompweb@latest`.

Then open [http://127.0.0.1:30177](http://127.0.0.1:30177). The CLI will try to open the browser automatically after the server is ready. ompweb listens on `127.0.0.1` by default.

### 🚀 Quick Start from Source (clone & run locally)

Clone this repository and run it directly on your machine:

```bash
# 1. Clone
git clone https://github.com/37chengshan/ompweb.git
cd ompweb

# 2. Install dependencies (Node.js >= 22.19 required, see .nvmrc)
npm install

# 3. Start the dev server
npm run dev
# → open http://127.0.0.1:30178
```

Requirements:

- **Node.js ≥ 22.19** (`.nvmrc` pins 22.19.0; `nvm use` will pick it up).
- **omp (oh-my-pi) CLI** on `PATH` (or set `OMP_WEB_OMP_BIN`). Live agent
  features and the built-in terminal need it; session browsing works without.
- **Native build toolchain** for the `node-pty` dependency during
  `npm install` when no prebuilt binary matches your platform:
  - Linux: `python3`, `make`, `g++` (`sudo apt install build-essential python3`)
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Windows: prebuilt binaries are shipped for arm64/x64 — no toolchain needed.
    The terminal spawns `cmd.exe` on Windows (input echo works over pipes;
    zsh-style PTY line editing is not available there).

Production-style check before publishing: `npm run release:check` (typecheck +
lint + tests + production build).

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
- **Configure less from the terminal**: manage models, login/API keys, model tests, task agents, native OMP controls (advisor, approval, Bash policy, thinking, compaction, memory, auto-learn, retry/fallback), skills (search, install, update checks), plugins, and project/global MCP servers from the web UI.
- **MCP management in Settings**: a dedicated MCP tab lists installed project and global servers with status (enabled / disabled / invalid), supports add/edit/rename/validate/remove, and surfaces configuration failures as corner toasts.
- **Slash commands that travel**: `/goal`, `/plan`, `/terminal`, `/theme`, `/mcp`, `/review`, `/fix`, `/test`, `/explain`, `/simplify`, `/commit`, and `/advisor` expand into well-structured prompts; omp's own commands (skills, `/compact`, …) appear via `available_commands_update`.
- **Keep OMP current**: check the installed runtime version, update it, and restart active sessions from Settings when needed.
- **Stay informed**: opt into browser notifications when an agent finishes, play a completion sound, and check installed skills for updates.
- **Jump anywhere with ⌘K**: a command palette (⌘K / Ctrl+K) for switching sessions, starting new ones, and toggling the theme.
- **Warm, paper-like design**: light and dark themes with serif display type and WCAG AA-verified contrast, built on a token-driven UI kit (Base UI primitives, cmdk, lucide icons).

## Configuration

| Variable | Meaning |
| --- | --- |
| `PORT` | Server port (default `30177`; `-p/--port` wins) |
| `OMP_WEB_HOSTNAME` | Bind hostname (default `127.0.0.1`; `-H/--hostname` wins) |
| `OMP_WEB_PASSWORD` / `--password` | Password for the sign-in screen; `--password` works in every shell (PowerShell/CMD) without `$env:` syntax |
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
- **MCP servers**: project and global servers are managed through OMP's native locations (`.omp/mcp.json`, `~/.omp/agent/mcp.json`), validated against the stdio/http/sse schema and written atomically.
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
npm run typecheck      # TypeScript type check (tsc --noEmit)
npm run lint           # ESLint
npm test               # Run native Node.js test suite
npm run build          # Production build
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
