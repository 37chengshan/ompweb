# Agent MCP × DeepSeek Harness（DSH）接入指南

把 agent-mcp 的 16 个 MCP 工具（12 核心编排工具 + `orchestrate_task` + `policy_list/policy_add/policy_state`）接入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）AI 会话，让 DSH 模型直接在工具目录里看到并调用 `mcp__agentmcp__*`。

## 0. 架构结论：零插件改造，stdio 直连

agent-mcp 不需要重写成 DSH 插件。DSH 原生自带 `@deepseek-ai/dsh-mcp-client` 插件，支持 **stdio transport**（spawn 子进程）：

```
DSH 会话 ── spawn mcp_server.py（stdio JSON-RPC）──► agent-mcp daemon（http://127.0.0.1:8765）
              └── 16 个工具注册为 mcp__agentmcp__<rawName>
```

- `mcp_server.py` 是无状态 stdio 薄层：逐行读 stdin JSON-RPC，EOF 退出码 0，异常不崩溃——天然适配 DSH 的断线重连循环（崩溃后指数退避自动重启，默认 10 次）。
- daemon 未起时 `mcp_server.py` 会自动**原子拉起**（探测 `/health` → 生成 token → spawn → 轮询），DSH 侧无需先手动启动；也可先用 `python3 start_agent_mcp.py` 手动幂等启动。
- 协议层支持 **MCP 2026-07-28**（最新规范，无状态核心）、**2025-11-25**（DSH SDK 1.29.0 的实际协商版本）与 **2025-03-26**（legacy）三套协商路径，见 §5。

## 1. 前置条件

| 项 | 要求 |
|---|---|
| Python | ≥ 3.10（macOS 自带 /usr/bin/python3 即可，零第三方依赖） |
| agent-mcp 源码或安装副本 | 仓库根目录（`mcp_server.py` + `agent_mcp/` 包）；若用 `~/.agent-mcp/` 安装副本，请先重新安装保持与源码同步 |
| 外部 CLI 登录态 | claude / grok / codex 等按需已登录（agent-mcp 不改写任何 CLI 配置） |
| DSH | 任意 profile（本机示例 `~/.dsh/profiles/web/`） |

## 2. 配置（host 平面，推荐）

DSH 的组合由 bundles + `cordis.patch.yml` 拼成，用户自定义层用 **patch 语法**。**推荐 host 平面**：一次连接、全会话共享同一组工具与同一 daemon。

### 2.1 单 profile 启用

编辑 `$DSH_HOME/profiles/<name>/cordis.patch.yml`（本机为 `~/.dsh/profiles/web/cordis.patch.yml`），追加：

```yaml
# 加入即启用；重启/刷新 DSH 后生效（HMR 可热替换）
- insert:
    - id: mcp-agentmcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: agentmcp
        transport: stdio
        command: python3
        args: ['/绝对路径/agent-mcp/mcp_server.py']
        # 可选：自定义状态目录/端口（缺省 ~/.codex/agent-mcp 与 8765）
        # env:
        #   AGENT_MCP_HOME: /绝对路径/状态目录
        #   AGENT_MCP_PORT: '8765'
        # 可选：DSH 单次工具调用超时（wait_agent 默认 25s 短阻塞循环，60s 已够；
        # 若想让模型一次等更久可调大，如 120000）
        # toolCallTimeoutMs: 120000
```

`command` 也可直接指向安装副本：`args: ['/Users/<you>/.agent-mcp/mcp_server.py']`。

### 2.2 全机所有 profile 启用

把同一个 `- insert:` 块合并进 `$DSH_HOME/cordis.patch.yml`（勿覆盖已有文件——先读后追加）。

### 2.3 临时试用（不改持久配置）

```bash
dsh web --patch /绝对路径/agent-mcp/examples/dsh/agentmcp.cordis.yml
```

`examples/dsh/agentmcp.cordis.yml` 即 §2.1 的 insert 块原文，可复制到任意路径。

## 3. 配置（agent preset 平面，备选）

若只想让特定 agent preset 使用 agent-mcp（每会话独立 spawn 一个 mcp_server 子进程，隔离更强但开销更高），在本地 preset 组合 `~/.dsh/.agent-presets/<id>/agent.cordis.yml` 中加一行：

```yaml
- id: mcp-agentmcp
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: agentmcp
    transport: stdio
    command: python3
    args: ['/绝对路径/agent-mcp/mcp_server.py']
```

> 注意：mcp-client 只消费 host 的 `tools` 注册表、不发布服务，preset 平面不违反 realm 规则；但**每个会话各 spawn 一个子进程**，且 daemon 仍为全机共享。默认推荐 host 平面（§2）。

## 4. 配置项说明

| 字段 | 值 | 说明 |
|---|---|---|
| `serverName` | `agentmcp` | 工具命名空间：模型看到 `mcp__agentmcp__<rawName>` |
| `transport` | `stdio` | 子进程管道传输（DSH 支持 streamable-http，stdio 已够用） |
| `command` / `args` | `python3` + mcp_server.py 绝对路径 | 不经过 shell，无注入面 |
| `env` | 可选 | `AGENT_MCP_HOME` / `AGENT_MCP_PORT` 等；DSH 子进程保留非凭据环境变量，`DSH_*` 与凭据形变量会被剥离（agent-mcp 不需要它们） |
| `failOnStartupError` | `false`（默认） | 首连失败不阻塞插件激活，重连循环接管 |
| `reconnect` | 默认即可 | `enabled: true`、退避 500ms→30s、单次断线最多 10 次 |
| `toolCallTimeoutMs` | 默认 60000 | `wait_agent` 默认 25s 单次短阻塞 ≤ 60s；模型可循环调用等待长任务 |

## 5. 协议协商（2026-07-28 / 2025-11-25 / 2025-03-26）

`mcp_server.py` 按客户端能力自动协商（v2.2.0 起）：

| 客户端 | 握手方式 | 协商结果 | 特性 |
|---|---|---|---|
| DSH（SDK 1.29.0） | initialize 顶层 `protocolVersion: 2025-11-25` | **2025-11-25** | 全量 16 工具、`structuredContent`、tasks（若声明） |
| Claude Code / Codex 等旧客户端 | initialize 无版本 | 2025-03-26 | 全量 16 工具、legacy 响应 |
| 2026-07-28 无状态客户端 | 每请求 `_meta` 版本 + `server/discover` | 2026-07-28 | resultType / ttlMs / cacheScope / tasks 扩展 |

- 工具列表**默认全量返回 16 个**；仅当 2026-07-28 客户端在 `_meta.clientCapabilities.extensions` 显式声明 `io.modelcontextprotocol/tools.used` 时才按声明裁剪（通用四件常驻）。
- 服务端绝不会在 initialize 响应中回 2026-07-28 给不支持它的 SDK（1.29.0 会拒绝连接）。
- 官方规范变更参考：[2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog.md) · [Tasks](https://modelcontextprotocol.org/specification/2025-11-25/basic/utilities/tasks) · [MRTR](https://modelcontextprotocol.io/seps/2322-mrtr)。

## 6. session_id 与续接行为

- DSH 不注入 `CLAUDE_CODE_SESSION_ID` / `CODEX_THREAD_ID`，mcp_server 识别 host 为 `unknown`，走**持久化兜底**：`<state_dir>/session-id-unknown` 文件（重启不变）→ 同一台机器上 DSH 重连、daemon 重启后旧 agent 仍可 `list_agents` 找回、`followup_task` 续接。
- 重连语义：DSH 子进程崩溃 → mcp-client 指数退避重启子进程（新进程重新协商，session 文件不变）；daemon 崩溃 → mcp_server 探测失败后自动重新拉起。
- 更换宿主/对话才需要新 spawn（`list_agents include_other_sessions=true` 找回旧状态）。

## 7. 验证步骤

```bash
# 1) daemon 幂等启动（可省：MCP 首调自动拉起）
python3 start_agent_mcp.py          # 首次 started / 再次 already_running
curl -s http://127.0.0.1:8765/health

# 2) 模拟 DSH 握手（python3 零依赖）
python3 - <<'EOF'
import json, subprocess, sys
p = subprocess.Popen([sys.executable, "mcp_server.py"], stdin=subprocess.PIPE,
                     stdout=subprocess.PIPE, text=True)
def rpc(msgs):
    for m in msgs: p.stdin.write(json.dumps(m) + "\n")
    p.stdin.flush()
    out = []
    for _ in msgs:
        line = p.stdout.readline()
        out.append(json.loads(line))
    return out
rpc([{"jsonrpc": "2.0", "id": 1, "method": "initialize",
      "params": {"protocolVersion": "2025-11-25",
                 "clientInfo": {"name": "dsh-mcp-client", "version": "0.0.1"},
                 "capabilities": {}}}])
res = rpc([{"jsonrpc": "2.0", "id": 2, "method": "tools/list"}])[0]["result"]
print("tools:", len(res["tools"]), [t["name"] for t in res["tools"]][:4], "...")
p.kill()
EOF
# 期望：initialize 回 2025-11-25；tools/list 返回 16 个工具
```

3. 真实 DSH 会话：写入 §2 的 patch → 刷新/重启 → 工具目录出现 `mcp__agentmcp__*`（16 个）。
4. 调用 `mcp__agentmcp__estimate_complexity`（本地直算、零 spawn）→ 返回 `level` + `rationale`。
5. 调用 `mcp__agentmcp__spawn_agent`（`target_cli=omp` 或 `claude`，读密集任务，`permission_mode=plan`）→ 循环 `mcp__agentmcp__wait_agent`（timeout 25）至 `terminated`，核对 `FINAL_ANSWER` 摘要与 `usage`。
6. 重启 daemon（kill 后 `python3 start_agent_mcp.py`）→ DSH 侧 `list_agents` 仍可查到旧 agent。

> 可复用验证脚本（与 DSH 桥接层同款 SDK 1.29.0 做真实握手）：`examples/dsh/verify_handshake.mjs`，
> 用法见文件头部注释（`DSH_SDK_DIR` 指向 DSH 仓库内 MCP SDK 包目录）。

## 8. 故障排查

| 症状 | 原因与处理 |
|---|---|
| 工具目录没有 `mcp__agentmcp__*` | patch 未生效（检查 `cordis.patch.yml` 语法与 profile 名）；或首次连接失败且 `failOnStartupError=false` 静默——查 DSH 日志，`dsh web --patch` 先行验证 |
| 工具只有 4 个（spawn/wait/interrupt/estimate） | 旧版 mcp_server 的裁剪行为；升级到 v2.2.0（默认全量） |
| 调用报 daemon 失联 | 看 `<state_dir>/daemon.err.log`；`python3 start_agent_mcp.py` 手动拉起 |
| `session_mismatch` 错误 | agent 属于另一会话；`list_agents include_other_sessions=true` 找回，勿复用旧 agent_id，重新 spawn 带前次上下文 |
| wait_agent 被 60s 截断 | DSH 默认 `toolCallTimeoutMs=60000`；wait_agent 默认 25s 短阻塞循环调用即可，或调大 `toolCallTimeoutMs` |

## 9. 安全边界

- daemon 仅绑定 `127.0.0.1`，`X-Auth-Token` 认证；token 存于 `<state_dir>/daemon.json`（0600），仅本地 API 调用使用。
- spawn 的 `permission_mode` 默认 `plan`，写文件才升档；策略引擎（预算/审批/工具限权）在 daemon 入口 enforcement。
- 外部 CLI 使用本机正常登录态，agent-mcp 不改写任何 CLI 配置。
- DSH 子进程环境剥离凭据形变量与 `DSH_*`，`AGENT_MCP_*` 正常透传。
