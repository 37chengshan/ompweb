# rinadelph/Agent-MCP → 本地 agent-mcp 移植评估（2026-08-12）

> 依据：clone `/tmp/Agent-MCP-review`（浅克隆，9.7MB）源码走查。
> 范围：memory bank（project_context / RAG / file_metadata / agent_messages）移植可行性。

## 上游架构（证据）

| 组件 | 实现 | 依赖 |
|---|---|---|
| `project_context` 表 | context_key/value(JSON)/description/last_updated/updated_by，键值式项目记忆，agent 或 admin 写入，带审计（`log_agent_action_to_db`） | stdlib SQLite |
| `file_metadata` 表 | filepath/metadata(JSON)/content_hash(SHA256 变更检测)/last_updated | stdlib |
| `rag_chunks` + `rag_embeddings` | 切块文本表 + sqlite-vec vec0 虚拟表，k=13 距离检索 | **sqlite-vec C 扩展** |
| `rag_meta` 表 | 索引进度游标（markdown/code/context/filemeta/tasks 五类源） | stdlib |
| `agent_messages` 表 | sender/recipient/type/priority/delivered/read，带三索引 | stdlib |
| 切块 | `chunking.py`：simple（固定窗口+overlap）+ markdown-aware（按标题断行）；`code_chunking.py`：AST 实体提取（Python 用 ast 模块，JS/C 系正则） | Python ast = stdlib |
| embedding | Python 版仅 OpenAI AsyncEmbeddings（批量 50、并发 25）；Node 版支持 Ollama/Gemini/HuggingFace/本地 server | **openai SDK + API key** |
| 检索合成 | 三段式：live context（最近更新 LIMIT 5）＋ tasks LIKE 关键词 ＋ 向量检索，拼装后喂 chat model 合成答案 | openai chat |
| 周期索引 | anyio 后台任务每 300s 扫盘（忽略 node_modules/venv/.git 等 19 类目录），增量更新 | anyio |

## 与本地项目契合度

本地项目约束：**零依赖 stdlib**、SQLite 已有（agents/events/usage）、派发为真实 CLI 子进程池、上下文为单向父摘要注入、SKILL 明确"文件冲突决策不交给 MCP"。

| 上游组件 | 契合度 | 结论 |
|---|---|---|
| project_context 键值记忆 | 高 | ✅ 纯 stdlib，一张表 + 2 工具，补 session_id 列即与现有隔离模型吻合 |
| 关键词/LIKE 检索 | 高 | ✅ stdlib，中文场景 LIKE 比 FTS5 可靠 |
| FINAL_ANSWER 自动沉淀 | 高 | ✅ 现有 `_ingest_output` 已解析 FINAL_ANSWER，顺路写入记忆表即可 |
| file_metadata + content_hash 变更检测 | 中 | ⚠️ 纯 stdlib 可移植；价值依赖索引消费方（无 RAG 则用途有限） |
| agent_messages 子间通信 | 低 | ⚠️ 现有 send_message 是主→子挂起队列；子间通信与"单一汇合"模型冲突，SKILL 反模式 |
| sqlite-vec 向量检索 | 低 | ❌ C 扩展破坏零依赖；Python 版 embedding 仅 OpenAI（要 key + 花钱） |
| code-aware chunking（AST 实体） | 低 | ⚠️ 只为 RAG 服务；本地代码理解已有宿主 lsp 工具，重复造轮子 |

## 推荐移植方案（分层）

### 阶段 1 — 零依赖记忆银行（推荐，全部 stdlib）
1. `agent_mcp/db.py` 加表 `project_memory`：
   - `id`、`session_id`（隔离）、`kind`（decision/lesson/convention/final_answer）、`key`（可选）、`content`、`tags`、`created_at`、`source`（agent_id/事件 seq）
   - 索引：`(session_id, kind)`、`(session_id, created_at)`
2. 两个 MCP 工具（daemon HTTP 端点 + mcp_server 注册）：
   - `memory_store`：写记忆（kind/key/content/tags）
   - `memory_recall`：检索——先 LIKE 关键词命中，再按 kind/时间过滤，`limit` 上限、`min_age` 可设
3. **自动沉淀**：`_ingest_output` 解析到 FINAL_ANSWER 时自动写入 kind=final_answer（source 指向事件）；子代理报 NEEDS_DECISION 的问答对由主 agent 决定是否 store
4. **spawn 注入**：spawn 时按 prompt 关键词召回 top-K 记忆，经现有 `_compact_context` 通道注入 context（复用 context_mode 压缩，不新开机制）
5. 工具暴露随 `_pruned_tools` 裁剪规则走（默认 4 件 + 声明制）

### 阶段 2 — 增强（可选）
- `memory_recall` 支持 FTS5（英文/代码场景），中文保留 LIKE 回退
- content_hash 文件索引：daemon 启动时扫项目文件变化，供记忆引用

### 阶段 3 — 重型 RAG（不建议，除非明确接受依赖）
- sqlite-vec + OpenAI embedding：破坏零依赖承诺 + 持续 API 成本；收益（语义检索）对"摘要级记忆"场景有限

## 风险与成本

- 阶段 1：~3 个文件（db.py / daemon_main.py / mcp_server.py）+ 2 个测试文件，约半天；无新依赖
- 记忆膨胀：需 `memory_recall` 默认按时间+limit 收敛，避免 prompt 注入失控
- 与现有 session 隔离的边界：记忆默认仅同 session 可见；跨会话共享需显式 `scope=global`（默认关）

## 结论

移植 **阶段 1（键值记忆 + 关键词召回 + FINAL_ANSWER 自动沉淀）** 价值/成本比最高，完全符合零依赖原则；向量 RAG 与子间通信与本地架构冲突，不建议。
