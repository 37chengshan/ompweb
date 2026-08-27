# MCP 协议对齐记录：2026-07-28 无状态规范 + 2025-11-25 兼容（v2.2.0）

日期：2026-08-14 · 范围：mcp_server.py 协议层 + daemon_main.py 端口口径 + tests + docs

## 背景

MCP 官方于 2026-07-28 发布问世以来最大更新：**无状态核心**（移除 initialize 握手与 session，每请求 `_meta` 携带协议版本与客户端能力）、`server/discover`、tasks 移入官方扩展、MRTR、resultType/ttlMs/cacheScope 必填、错误码重编号。官方 changelog：<https://modelcontextprotocol.io/specification/2026-07-28/changelog.md>。

同时 DSH（DeepSeek Harness）所用 MCP SDK 1.29.0 的 LATEST 协议版本为 **2025-11-25**（SUPPORTED = [2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07]，不含 2026-07-28），客户端以 initialize 顶层 `protocolVersion` 协商。

## 问题（改动前）

1. `_request_protocol()` 只识别 `_meta.io.modelcontextprotocol/protocolVersion`（2026-07-28 方式）→ 真实客户端（含 DSH）永远走 legacy 2025-03-26：structuredContent / tasks / resultType 全部失效。
2. initialize 响应写死 2025-03-26，不随客户端请求版本协商。
3. `_pruned_tools()` 依赖 `_meta.clientCapabilities.extensions['io.modelcontextprotocol/tools'].used` → 不发送该声明的客户端（DSH 等全部真实客户端）只见 4 个通用工具，12 核心工具不可见。
4. 任务对象字段名 `ttlMs`/`pollIntervalMs` 与官方 schema（`ttl`/`pollInterval`）不符；tasks 缺能力错误码用了未定义的 -32023（官方重编号为 -32021）。
5. `server/discover` 的 supportedVersions 缺 2025-11-25。

## 改动

### mcp_server.py（协议层）

- 支持版本集 `[2026-07-28, 2025-11-25, 2025-03-26]`；initialize 读**顶层** `protocolVersion` 协商并回显（不在支持集则 legacy 兜底，绝不回 2026-07-28 给不支持它的 SDK）；进程级记录会话版本供后续请求复用。
- modern 判定 = 协商版本 ∈ {2026-07-28, 2025-11-25}（structuredContent / resultType / ttlMs / cacheScope 对 2025-11-25 生效）。
- tools/list **默认全量 16 工具**；仅 2026-07-28 客户端显式声明 `tools.used` 时才裁剪（通用四件常驻）。
- tasks 能力识别双路径：2026-07-28 `_meta` extensions 声明 或 2025-11-25 initialize `capabilities.tasks`（experimental）。
- `_task_result` 字段对齐官方 schema：`ttl` / `pollInterval`；resultType 统一 `complete`（枚举内合法值）。
- 错误码 -32023 → -32021（MissingRequiredClientCapability）。
- `server/discover` supportedVersions 三版本；SERVER_VERSION 2.1.0 → 2.2.0。

### agent_mcp/daemon_main.py

- `--port` 默认值读 `AGENT_MCP_PORT`，与 mcp_server / start_agent_mcp 同口径（此前手动 `python agent_mcp/daemon_main.py` 忽略该变量落在 8765）。

### 测试与文档

- tests/test_mcp_server.py：新增顶层版本协商、全量工具、2026-07-28 声明裁剪、2025-11-25 capabilities.tasks 等用例；更新字段名/错误码/supportedVersions 断言（56 项全过）。
- docs/dsh-integration.md（新）：DSH 双平面接入模板 + 协商矩阵 + 验证清单 + 故障排查。
- README.md：顶部 DSH 支持强调块 + 特性表/文档链接；install-guide.md 增补 DSH 段落；examples/dsh/agentmcp.cordis.yml 临时试用 patch。

### agent_mcp/daemon_main.py（多维度审查中修复的三个真实环境问题）

1. **终态摘要提取修复**：omp/atomcode 的 out 是单行巨型 JSON 会话转储，原 `_tail(out_path)` 取文件末尾会抓到工具结果碎片而非 FINAL_ANSWER。新增 `_final_summary()`：采样文件尾部 256KB，优先提取 `FINAL_ANSWER:` 标记（单行场景再截到 JSON 结构边界 `"}]`/`"},`/`"],`），无标记回退尾部截断；替换 wait 与 `_check_worker` 两处调用点。
2. **wait summary 兜底修复**：`_last_event_payload()` 原用 `events_since(0)`（升序 limit=1000 = 最早 1000 条），真实库事件超限后取不到最新 terminated 事件 → summary 空。改为按会话过滤 + limit=5000。
3. **终态事件竞态修复**：`_check_worker` 原顺序为 `_set_status`（内含 ev.set() 唤醒 wait）→ `_broadcast`（事件落库），wait 唤醒后 fast-path 兜底可能在事件落库前查询 → summary 空（毫秒级窗口）。终态分支改为**事件先落库、再置终态**。

## 验证

- `python3 -m pytest tests/`：364 passed / 6 skipped / 1 failed（`test_claude_real_spawn_smoke` 为环境依赖的真实 claude CLI 冒烟，与本次改动无关，项目既有"无真实 CLI 约束"先例）。
- DSH 同款 SDK 1.29.0 真实握手（initialize 2025-11-25 → tools/list 16 工具 → estimate_complexity structuredContent）通过。
- 真实 spawn_agent（omp、plan、读密集）+ wait_agent 循环阻塞至 terminated：FINAL_ANSWER 摘要正确回传、usage 五元组正常。
- daemon 两次重启后旧 agent（127）经 `list_agents include_other_sessions=true` 仍可找回（session 持久化兜底生效）。
- 本机 DSH host 平面 patch 已写入 `~/.dsh/profiles/web/cordis.patch.yml`，重启 DSH 后工具目录应出现 `mcp__agentmcp__*` 16 个。

## 后续（P2，未做）

- streamable-http transport（2026-07-28 无状态 HTTP：无 Mcp-Session-Id、Mcp-Method/Mcp-Name 头、subscriptions/listen）——DSH stdio 已覆盖。
- ~/.agent-mcp 安装副本重装同步。
