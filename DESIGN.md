# ompweb — Product & Architecture Contract

## Purpose

ompweb is a local, browser-based workspace for the
[oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`) coding agent. It lets a
user browse the same local sessions they use in the terminal, continue live
work, configure supported OMP settings, and inspect project files without
creating a second agent runtime or a second source of truth.

The project originated from [agegr/pi-web](https://github.com/agegr/pi-web)
(MIT), but it is maintained as an OMP-focused downstream. We preserve the
license and attribution, and selectively learn from upstream improvements; we
do not assume that Pi-specific implementation changes can be merged unchanged.

## Product principles

1. **OMP remains authoritative.** Sessions, credentials, providers, and agent
   behavior belong to the installed `omp` CLI. ompweb must not invent a
   parallel data format or credential store.
2. **Local-first by default.** The server binds to `127.0.0.1`; remote access
   is an explicit user choice and must be protected by a trusted network
   boundary and HTTPS.
3. **Node-first installation.** A normal user installs Node.js 22.19+ and OMP,
   then runs `npx ompweb@latest` or installs `ompweb` globally. ompweb does not
   require users to install Bun for its own runtime.
4. **Native compatibility over imitation.** Prefer OMP's CLI and documented
   on-disk formats to copied SDK internals. If a capability cannot be done
   safely through those boundaries, leave it out rather than emulating it
   speculatively.
5. **A calm, capable workspace.** The UI should make active work, session
   history, configuration, and project context understandable without hiding
   the agent's state or expanding the app into a general remote-control plane.

## Distribution and identity

- npm package and CLI command: `ompweb`.
- Default server address: `http://127.0.0.1:30177`.
- Existing `OMP_WEB_*` environment variables remain the configuration prefix
  for compatibility: `OMP_WEB_HOSTNAME`, `OMP_WEB_NO_OPEN`,
  `OMP_WEB_PASSWORD`, and `OMP_WEB_OMP_BIN`.
- `PI_CODING_AGENT_DIR`, profiles, and OMP's own directory conventions are
  respected because they identify the user’s existing OMP state.
- The web UI displays its own package version separately from the detected
  installed OMP version; those versions may legitimately differ.

## Runtime architecture

```
Browser
  │ HTTP / Server-Sent Events
  ▼
ompweb (Next.js on Node)
  ├─ reads native OMP session files and selected configuration
  ├─ serves allow-listed project files
  └─ starts one `omp --mode rpc-ui` child per active session
       │ NDJSON over stdio
       ▼
     installed OMP CLI and its existing ~/.omp/agent state
```

### Why the CLI boundary is locked

OMP SDK packages are Bun-only TypeScript and import Bun APIs. Importing
`@oh-my-pi/*` or `@earendil-works/*` into a Node/Next server would make the
application unreliable or non-runnable. Therefore, production code must not
add those runtime dependencies.

Live work goes through the user’s installed `omp --mode rpc-ui` process. This
keeps the agent version, providers, extensions, and session behavior aligned
with the CLI the user already trusts. The RPC layer negotiates v2 when the CLI
advertises it, reassembles bounded chunked frames, and remains compatible with
v1-capable installations.

## Data and mutation boundaries

### OMP-owned state

- `~/.omp/agent` (or OMP's configured/profiled equivalent) is the source of
  truth for sessions, configuration, models, skills, plugins, and blobs.
- `agent.db` contains authentication data. ompweb never reads or writes it;
  authentication actions go through the OMP RPC process.
- A live OMP process owns writes to its session file. ompweb routes supported
  live actions through RPC and never races a live file rewrite.

### Direct file access

Session browsing is implemented in pure Node against OMP JSONL files. The
reader tolerates the fixed title slot and older session shapes, resolves blob
references when needed, and builds the active branch context from the entry
tree.

Direct session mutation is deliberately narrow and explicit: rename/title,
archive, deletion, and required branch-parent maintenance. These writes are
atomic where possible; archive or deletion stops the associated live process
first. ompweb does not provide a general editor for session JSONL or opaque OMP
state.

Models and allow-listed OMP settings use surgical YAML updates that preserve
unrelated content. Plugin operations run the installed `omp plugin` CLI. MCP
configuration is project-local, validated before writing, and saved atomically.

## Security contract

- Bind loopback-only by default. A non-loopback hostname is an explicit opt-in.
- `OMP_WEB_PASSWORD` protects every route with a password-only sign-in screen.
  Successful sign-in creates an HTTP-only, signed cookie with a 30-day expiry;
  changing the configured password invalidates existing sessions. Exposed
  deployments require HTTPS through a trusted reverse proxy or VPN.
- API requests are origin-checked. Do not add browser-to-host execution paths
  that bypass this boundary.
- OMP RPC host tools are intentionally not registered. A browser request must
  not become arbitrary host command execution through an extension callback.
- File APIs are not a general filesystem browser. They are restricted to
  selected workspaces, valid Git worktrees, session-referenced directories, and
  explicitly selected roots. Paths are canonicalized to reject traversal and
  symlink escapes.
- Secrets, raw API keys, and auth database contents never appear in API
  responses, logs, or the browser.

## UX contract

- The session sidebar is the durable navigation model: projects, sessions,
  branches, worktrees, and files must agree about the selected workspace.
- Streaming state is explicit. The UI reconciles Server-Sent Events with RPC
  state so a background tab cannot remain falsely “running”.
- Desktop and mobile share the same core workflow. Mobile controls keep usable
  touch targets and a visible loading state rather than a blank shell.
- Accessibility and motion preferences are first-class. Components use the
  shared design tokens and UI primitives rather than one-off colors or controls.
- Expensive rendering is deferred until needed; responsiveness and initial
  bundle size are part of the product contract.

## Upstream and release strategy

`agegr/pi-web` is the historical source and a useful source of UI ideas,
bug fixes, and tests. Before adopting an upstream change, verify that it does
not depend on Pi runtime behavior or Bun-only APIs. Port the user-visible
behavior, not blindly the implementation.

Releases are independent:

1. Run typecheck, lint, relevant tests, and a production build.
2. Confirm `npm pack --dry-run` contains the built `.next` output and exposes
   the `ompweb` binary.
3. Publish `ompweb@<version>` only from an npm account authorized for that
   package.
4. Tag and release the repository that owns this downstream project.

## Non-goals

- Reimplementing OMP, its provider registry, or its credential database.
- Embedding Bun-only OMP SDK packages in the Node server.
- Turning a local agent workspace into an internet-facing multi-user service.
- Unrestricted filesystem browsing or arbitrary browser-triggered host tools.
- Automatic bulk synchronization from `agegr/pi-web`.

When a proposed feature conflicts with one of these boundaries, preserve the
boundary unless the design is intentionally revised first.
