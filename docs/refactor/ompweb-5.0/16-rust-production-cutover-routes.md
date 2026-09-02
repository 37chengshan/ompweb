# ompweb 5.0 Rust Production Cutover 路线（安装版）

<!--
安装记录（2026-09-02）：来源 /Users/cc/Downloads/ompweb_5.0_rust_production_cutover_route.md。
本文件为 5.0.0 发布后重启的 Rust Production Cutover 主计划；与 15-v4-production-cutover.md
（R0–R23）同属一个目标，路线编号不同——安装时已做逐条对照（下表）。
执行纪律沿用 15 号文档：每域 shadow → canary → cutover → legacy adapter → delete；
全量验证 + 实测证据过门；每阶段多维自审；backend-ownership.yaml 随域迁移逐行更新。
-->

## 安装时状态对照（2026-09-02）

| 路线 | 内容 | doc15 / yaml 对应 | 安装时状态 |
|---|---|---|---|
| 1 | 统一 Client SDK | R1（client 域） | ✅ 核心（lib/client + ESLint 门）；terminal/files/git/settings/commands/remote 调用未收口 |
| 2 | HostClient / Domain Backend 边界 | R8–R10 边界 | ◐ host IPC 已有（agent.*/journal.*/session.*）；无 formal HostClient 层与 Route 禁直接调用门 |
| 3 | ompweb-host 生产二进制定位 | R8 收尾 | ✅ 完成（2026-09-02）：resolution 阶梯 explicit/packaged/workspace + fail-closed（见 PROGRESS 路线 3） |
| 4 | 完整接管 Agent | R8（agent=rust） | ◐ 默认 rust 切流（R8.7）✅；**首切片实测发现并修复 --resume 传递缺陷（2026-09-02，P1）**；utility RPC / auth login / env 传递未收口 = 本路线其余切片；Node spawn 删除 = 路线 21 |
| 5 | Event Authority 迁 Rust | R9（event=rust） | ✅ 切流（attach→SSE adapter）；journal 生产写入 = 路线 6 |
| 6 | Journal / Snapshot / Resume | R6/R9 | ◐ SQLite journal 端点就绪（append/view）；生产接线、RESUME、client_msg_id 幂等未做 |
| 7 | Session Authority 迁 Rust | R7/R10（session=rust） | ✅ scan/rename/delete 切流；完整 SessionService（context/tree/blob/archive/search…）未做 |
| 8 | PTY 迁 Rust | R11（pty=node） | ⬜ node-pty（lib/terminal-shell.ts 等） |
| 9 | Files 迁 Rust | R12（files=node） | ⬜ app/api/files/* + lib/file-access.ts |
| 10 | Git 迁 Rust | R12（git=node） | ⬜ app/api/git/*、lib/git-*.ts、lib/worktree.ts |
| 11 | Settings 迁 Rust | R13（settings=node） | ⬜ lib/omp/settings-service.ts、app/api/omp-settings |
| 12 | Commands 迁 Rust | R14（commands=node） | ⬜ toSlashCommandInfo、app/api/scripts/run、ui-request |
| 13 | 统一 Device Identity | R15（remote=node） | ⬜ ADR-005 冻结（Noise_XX + SAS，Rust snow）；pairing cookie 权威未动 |
| 14 | Remote 迁 Rust | R16 | ⬜ ws 依赖决策已落（Node 真 WS 端点）；Rust RemoteRuntime 未做 |
| 15 | 多路径 Remote | 04/05 | ⬜ |
| 16 | Rust Relay | R17 | ⬜ 行为层 simulator 已落地；真实 relay 未做 |
| 17 | Headless Rust Host | P3.2 | ◐ ompweb-host 骨架（--ipc/supervisor/journal/session.scan）；完整 Host Runtime 未做 |
| 18 | Tauri Desktop | R18/R19 | ⬜ |
| 19 | Web Compatibility | R22（保留形态） | ⬜ 当前 Next 即迁移期形态 |
| 20 | Mobile Client | R20/R21 | ⬜ ADR-006 延后决策 |
| 21 | 删除 Node Authority | R22 | ⬜ 依赖路线 4–14 各自 cutover 完成 |
| 22 | 重构 backend-ownership.yaml | R0 收尾 | ⬜ 目标结构：capability/production_path/authority/fallback |
| 23 | 重构 Ownership CI | R23 | ◐ audit-backend-ownership.mjs 存在（存在性扫描）；call-graph 计数门未做 |
| 24 | 最终架构 | — | ⬜ |

> 说明：表格内容为安装时刻的仓库真实状态快照（对照 backend-ownership.yaml 与
> PROGRESS.md）；后续执行进度以 PROGRESS.md 为准。完成定义 = 本文末尾「最终完成条件」
> 九域 Rust Authority + Desktop/Remote/Headless 三条形态 + 无静默回退。

---


## 目标

当前真实生产形态：

```text
Electron
  ↓
Next / Node
  ↓
部分请求经过 ompweb-host --ipc
  ↓
Rust Supervisor
  ↓
OMP
```

同时仍存在大量 Node Authority：

```text
agent      部分 Rust
event      部分 Rust
session    部分 Rust
pty        Node
files      Node
git        Node
settings   Node
commands   Node
remote     Node
```

最终目标：

```text
Desktop
React
  ↓
Tauri IPC
  ↓
Rust Core
  ↓
OMP
```

```text
Remote
Mobile / Web Remote
  ↓
E2EE WebSocket
  ↓
Rust RemoteRuntime
  ↓
Rust Core
  ↓
OMP
```

```text
Headless
ompweb-host
  ↓
Rust Core
  ↓
OMP
```

最终要求：

```text
agent      Rust
event      Rust
session    Rust
pty        Rust
files      Rust
git        Rust
settings   Rust
commands   Rust
remote     Rust
```

Node / Next 只能作为：

```text
Web UI
Compatibility Adapter
Legacy HTTP Adapter
```

不能继续持有 Domain Authority。

---

# 路线 1：统一 Client SDK

把 React 中所有直接访问后端的业务调用统一收口。

从：

```text
React
 ├─ fetch("/api/...")
 ├─ EventSource(...)
 ├─ terminal API
 ├─ settings API
 └─ session API
```

改成：

```text
React
  ↓
OmpWebClient
  ├─ sessions
  ├─ agent
  ├─ events
  ├─ terminal
  ├─ files
  ├─ git
  ├─ settings
  ├─ commands
  └─ remote
```

提供三种 Adapter：

```text
LegacyHttpAdapter
TauriCoreAdapter
RemoteProtocolAdapter
```

React 不再知道底层是 Node、Rust、Tauri 还是 WebSocket。

---

# 路线 2：统一 Rust HostClient / Domain Backend 边界

在 Node 和 Rust 之间建立正式生产接口。

从当前类似：

```text
rpc-manager
  ↓
createRpcProcess()
```

扩展成完整 HostClient：

```text
HostClient
├─ agent
├─ events
├─ sessions
├─ terminal
├─ files
├─ git
├─ settings
├─ commands
├─ devices
└─ diagnostics
```

Node API Route 以后只能调用 HostClient。

禁止 Node Route 继续直接：

```text
spawn OMP
read/write JSONL
spawn node-pty
fs.writeFile
execFile("git")
write config.yml
维护 pairing authority
```

---

# 路线 3：修正 ompweb-host 生产二进制定位

去掉基于源码目录和 `import.meta.url` 推导：

```text
.../crates/target/debug/ompweb-host
```

建立正式运行时 binary resolution：

```text
Development
→ workspace target/debug/ompweb-host
```

```text
Packaged Desktop
→ application resources/bin/ompweb-host
```

```text
Headless / CLI
→ bundled host binary / explicit installation path
```

Rust host 不存在时：

```text
Stable
→ 明确报 Runtime unavailable
```

不再 silent fallback 到 Node Authority。

---

# 路线 4：完整接管 Agent

所有 OMP process creation 收口到 Rust Supervisor。

包括：

```text
normal session
resume session
restart
utility RPC
auth login
provider/model discovery
advisor
tools preset
extra args
environment
cwd
```

统一：

```text
Node / Tauri / Headless
        ↓
     HostClient
        ↓
Rust AgentSupervisor
        ↓
       OMP
```

Rust `agent.spawn` 必须完整接收并传递：

```text
cwd
session_id
resume
tools
advisor
extra_args
environment
runtime options
```

完成后删除生产 Node：

```text
new RpcProcess(...)
spawn("omp", ...)
```

最终：

```text
agent = rust
```

---

# 路线 5：Event Authority 全部迁入 Rust

从当前：

```text
OMP
 ↓
Rust broadcast
 ↓
Node handleFrame
 ↓
Node state
 ↓
SSE
```

改成：

```text
OMP
 ↓
Rust Normalizer
 ↓
Event Classification
 ↓
Sequence Assignment
 ↓
Journal
 ↓
Rust EventBus
 ├─ Tauri Channel
 ├─ Remote WebSocket
 └─ Legacy SSE Adapter
```

可靠事件先写 Journal，再广播；高频 delta 在 Rust 内合并后广播。

Node SSE 只保留：

```text
Rust EventBus
 ↓
SSE compatibility adapter
```

最终：

```text
event = rust
```

---

# 路线 6：完成 Event Journal / Snapshot / Resume

Rust Runtime 统一维护：

```text
event_id
session_seq
stream_seq
client_msg_id
```

建立：

```text
SQLite WAL
├─ events
├─ snapshots
├─ commands
├─ devices
└─ session projection
```

流程：

```text
Client reconnect
 ↓
RESUME(session_id, last_seq)
 ↓
Rust Journal
 ├─ replay delta
 └─ snapshot + tail
 ↓
SYNC_COMPLETE
```

所有有副作用操作加入 `client_msg_id`，实现幂等：

```text
Prompt
Cancel
Approve
Reject
Steer
Settings mutation
Git mutation
File mutation
Terminal mutation
Command execution
```

---

# 路线 7：Session Authority 全部迁入 Rust

把现有 Rust session 能力扩展为完整 SessionService。

Rust 负责：

```text
list
metadata
context
transcript
tree
branch relationship
blob resolution
archive
restore
import
rename
delete
reparent
path resolution
filesystem watch
incremental parse
projection
search
FTS
cache
```

OMP JSONL 继续是 Session Authority，Rust SQLite 只是 Projection / Index / Journal。

Node `/api/sessions/*` 可以保留，但只能：

```text
HTTP request
 ↓
HostClient.sessions.*
 ↓
Rust SessionService
```

Node 不再直接读写 Session JSONL。

最终：

```text
session = rust
```

---

# 路线 8：PTY 全部迁入 Rust

从：

```text
React xterm
 ↓
Next terminal API
 ↓
node-pty
```

改成：

```text
React xterm
 ↓
Client SDK
 ↓
Rust PTY Manager
 ↓
native PTY / ConPTY
```

Rust 负责：

```text
spawn
stdin
stdout
resize
signals
kill
scrollback
flow control
pause/resume
remote streaming
```

删除 production `node-pty`。

最终：

```text
pty = rust
```

---

# 路线 9：Files 全部迁入 Rust

建立 Rust FileService：

```text
workspace root
canonicalization
symlink protection
read
range read
write
atomic replace
upload
delete
rename
mkdir
list
watch
metadata
chunked transfer
```

Node `/api/files/*` 只保留兼容代理。

最终：

```text
files = rust
```

---

# 路线 10：Git 全部迁入 Rust

建立 Rust GitService：

```text
status
diff
log
branch
checkout
worktree
add
commit
push
reset
```

统一：

```text
argv construction
cwd validation
timeout
cancel
security policy
capability
approval
```

Node 不再直接执行 `git`。

最终：

```text
git = rust
```

---

# 路线 11：Settings 全部迁入 Rust

建立：

```text
OMP Settings Schema
 ↓
Rust Settings Registry
 ↓
Rust SettingsService
 ↓
Client SDK
 ↓
Desktop / Web / Mobile
```

Rust 统一负责：

```text
registry
read
configured value
effective value
default
source
scope
set
reset
revision
conflict
atomic write
reload
```

Node 不再直接读写 OMP YAML，也不直接执行配置 mutation。

最终：

```text
settings = rust
```

---

# 路线 12：Commands 全部迁入 Rust

建立 Rust Command Registry。

统一来源：

```text
OMP builtin
OMP dynamic commands
extensions
custom commands
prompt templates
skills
ompweb host commands
```

Rust 统一维护：

```text
name
aliases
provider
source
availability
arguments
security class
execution mode
shadowing / precedence
```

执行：

```text
Command Palette
 ↓
Client SDK
 ↓
Rust CommandExecutor
```

统一 HostUIRequest：

```text
confirm
select
input
editor
```

React 只负责渲染。

最终：

```text
commands = rust
```

---

# 路线 13：统一 Device Identity

把：

```text
pair token
cookie
remote-pairing.json
```

升级为：

```text
Host Identity
Device Identity
Enrollment
Capability
Revocation
```

使用成熟密码学实现完成身份与密钥协商。

QR 只用于 Enrollment Bootstrap，长期身份由 Device Keypair + Device Registry 负责。

---

# 路线 14：Remote 全部迁入 Rust

从：

```text
Phone
 ↓
Next /remote
 ↓
PairingService
 ↓
cookie
 ↓
Next APIs
 ↓
SSE
```

改成：

```text
Phone
 ↓
E2EE WebSocket
 ↓
Rust RemoteRuntime
 ↓
Rust Core
```

Rust RemoteRuntime 负责：

```text
HELLO
AUTH
PAIR / ENROLL
SUBSCRIBE
RESUME
PROMPT
CANCEL
APPROVE
REJECT
SETTINGS
COMMAND
PTY
FILES
GIT
PING/PONG
FLOW CONTROL
```

协议分为：

```text
Control
Event
Data
```

Mobile 正式操作不再经过 Next API。

最终：

```text
remote = rust
```

---

# 路线 15：多路径 Remote

Remote 支持：

```text
LAN Direct
VPN Direct
Relay
```

流程：

```text
discover candidates
 ↓
probe
 ↓
select route
 ↓
authenticate
 ↓
resume
```

路径切换后由 Resume 保证状态重新收敛。

---

# 路线 16：Rust Relay

建立独立：

```text
ompweb-relay
```

职责：

```text
rendezvous
presence
routing
encrypted frame forwarding
rate limit
health
region
```

Relay 不保存 Prompt、源码、Session Transcript、Terminal 明文或 Private Key，只转发 E2EE payload。

---

# 路线 17：Headless Rust Host

让 `ompweb-host` 从 IPC helper 升级为完整 Host Runtime：

```text
ompweb-host
├─ Rust Core
├─ OMP Supervisor
├─ Event Journal
├─ Session Engine
├─ PTY
├─ Files
├─ Git
├─ Settings
├─ Commands
├─ Remote Runtime
├─ Device/Security
└─ Diagnostics
```

Headless 不依赖 Node / Next。

---

# 路线 18：Tauri Desktop

当 Rust Core 已成为完整 Production Authority 后：

```text
Electron
 ↓
Next standalone
 ↓
Rust Host
```

切成：

```text
Tauri
├─ React WebView
└─ Rust Core
     ↓
    OMP
```

Tauri 直接 link 相同 Rust Core。

本地调用：

```text
React
 ↓
TauriCoreAdapter
 ↓
Tauri IPC / Channel
 ↓
Rust Core
```

Desktop 不再启动 Node / Next standalone / Electron。

---

# 路线 19：Web Compatibility

Web 可以继续保留 Next：

```text
Web React / Next
 ↓
RemoteProtocolAdapter / Local HostClient
 ↓
Rust Host
```

Next 只负责 Web Rendering、SSR、HTTP Compatibility、Static Assets，不再拥有 Agent Runtime。

---

# 路线 20：Mobile Client

Mobile 与 Desktop 使用相同 Domain Contract。

能力：

```text
Hosts
Sessions
Streaming
Prompt
Cancel
Approval
Resume
Notifications
Terminal
Files
Git
Settings
Commands
```

后台模型：

```text
disconnect
 ↓
foreground
 ↓
reconnect
 ↓
RESUME
 ↓
state converge
```

Push 只负责通知，不承担状态 Authority。

---

# 路线 21：删除 Node Authority

当九个 Domain 全部由 Rust 承担后，删除 production：

```text
Node RpcProcess
Node OMP spawn
Node Event Authority
Node Session JSONL mutation
node-pty
Node File mutation
Node Git mutation
Node Settings mutation
Node Command Authority
Node Pairing Authority
Next SSE Runtime Authority
```

只保留：

```text
LegacyHttpAdapter
Web compatibility
migration tooling
tests
```

---

# 路线 22：重构 backend-ownership.yaml

不再只写：

```yaml
agent: rust
```

改成：

```yaml
agent:
  capability: rust
  production_path: rust
  authority: rust
  fallback: none
```

所有 Domain 使用同样结构。

只有：

```text
capability = rust
production_path = rust
authority = rust
fallback = none
```

才视为完成迁移。

---

# 路线 23：重构 Ownership CI

CI 不再只验证 Rust 文件存在，还验证真实 Production Call Graph：

```text
Node OMP spawn = 0
Node authoritative session mutation = 0
Node event authority = 0
node-pty production use = 0
Node workspace file mutation = 0
Node git mutation = 0
Node settings mutation = 0
Node command authority = 0
Node remote authority = 0
```

同时执行 Node-independent Desktop 测试。

---

# 路线 24：最终架构

```text
                         OMP
                          │
                    Rust Adapter
                          │
                  ┌───────▼───────┐
                  │   Rust Core   │
                  │               │
                  │ Agent         │
                  │ Event         │
                  │ Session       │
                  │ PTY           │
                  │ Files         │
                  │ Git           │
                  │ Settings      │
                  │ Commands      │
                  │ Remote        │
                  │ Security      │
                  │ Journal       │
                  │ Diagnostics   │
                  └───────┬───────┘
                          │
                   Unified Client SDK
                          │
              ┌───────────┼───────────┐
              │           │           │
          Desktop        Web       Mobile
           Tauri       Browser      App
```

Headless：

```text
ompweb-host
 ↓
Rust Core
 ↓
OMP
```

Remote：

```text
Mobile
 ↓
LAN / VPN / Relay
 ↓
E2EE WebSocket
 ↓
Rust RemoteRuntime
 ↓
Rust Core
```

---

# 最终完成条件

```text
agent      Rust Authority
event      Rust Authority
session    Rust Authority
pty        Rust Authority
files      Rust Authority
git        Rust Authority
settings   Rust Authority
commands   Rust Authority
remote     Rust Authority
```

同时：

```text
Desktop 无 Node 仍完整运行
Remote 不依赖 Next API / SSE
Headless 不依赖 Node / Next
Rust failure 不 silent fallback Node
Tauri / Headless / Remote 共用同一 Rust Core
```

达到以上状态，即完成 ompweb 5.0 Rust Production Cutover。
