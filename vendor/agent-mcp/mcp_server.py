#!/usr/bin/env python3
"""Agent MCP 薄层（stdio，零依赖，无状态）。

三主载体（codex/claude/omp）注册同一 MCP server；clientInfo.name 识别 host，
会话隔离（session_id = host + uuid，首次 tools/call 生成后透传）。

tools/call 全部映射到常驻 daemon 的 HTTP POST 端点（X-Auth-Token 认证）；
daemon 未起时 ensure_daemon() 原子拉起（探测 /health → 生成 token → spawn → 轮询）。
所有失败以结构化 {status:"error", summary, root_cause_hint?, next_actions} 返回，不抛异常。
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import http.client
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from agent_mcp import SESSION_MISMATCH_MARK, __version__
from agent_mcp.cli_adapters import adapter_names, load_custom_adapters
from agent_mcp.orchestrator import Orchestrator, OrchestratedTask

SERVER_VERSION = __version__
LEGACY_PROTOCOL_VERSION = "2025-03-26"
# 2025-11-25：官方 MCP 中间版本（SDK 1.29.0 的 LATEST，DSH 客户端所发版本），
# 拥有 structuredContent / tasks 等 modern 特性但仍是 initialize 握手式会话协议。
BRIDGE_PROTOCOL_VERSION = "2025-11-25"
# 2026-07-28：最新规范，无状态核心（_meta 版本协商 + server/discover，无 initialize）。
MODERN_PROTOCOL_VERSION = "2026-07-28"
SUPPORTED_PROTOCOL_VERSIONS = [MODERN_PROTOCOL_VERSION, BRIDGE_PROTOCOL_VERSION,
                               LEGACY_PROTOCOL_VERSION]
PROTOCOL_VERSION = LEGACY_PROTOCOL_VERSION
DAEMON_HOST = "127.0.0.1"
DAEMON_PORT = int(os.environ.get("AGENT_MCP_PORT", "8765"))


def state_dir_from_env() -> Path:
    """AGENT_MCP_HOME 优先；兼容 CODEX_HOME；缺省 ~/.codex。与 daemon_main 同口径。"""
    base = (os.environ.get("AGENT_MCP_HOME")
            or os.environ.get("CODEX_HOME")
            or Path.home() / ".codex")
    return Path(base) / "agent-mcp"


STATE_DIR = state_dir_from_env()
DAEMON_JSON = STATE_DIR / "daemon.json"
# 策略引擎位于 daemon（daemon_main.Dispatcher.policy_engine）——唯一数据源，
# spawn/usage 数据都在 daemon 进程内，enforcement 与面板同源（H1/H2 修复）。
# 自定义 CLI 适配器（<state_dir>/custom-clis/*.json）与本层同步注册，
# 使 spawn_agent 的 target_cli enum 动态包含用户自定义 CLI
load_custom_adapters(STATE_DIR)
_CLI_NAMES = adapter_names()
SESSION_ID_PREFIX = STATE_DIR / "session-id"
# 宿主注入的稳定会话标识（同对话 resume 不变）优先；缺失时按 host 持久化兜底
_HOST_SESSION_ENV_VARS = ("CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID",
                          "CODEX_THREAD_ID", "CODEX_SESSION_ID")
DAEMON_SCRIPT = Path(__file__).resolve().parent / "agent_mcp" / "daemon_main.py"
_PROBE_ATTEMPTS = 10
_PROBE_INTERVAL = 0.5
_HTTP_TIMEOUT = 60  # 常规请求基础超时；wait_agent 按请求时长叠加（见 call_tool）
# wait_agent 单次阻塞上限：默认 600s（10 分钟），与 daemon 侧 AGENT_MCP_MAX_WAIT 同口径
MAX_WAIT_SECONDS = float(os.environ.get("AGENT_MCP_MAX_WAIT", "600"))

_HOST = "unknown"
_SESSION_ID: str | None = None
# initialize 握手协商出的会话协议版本（2025-03-26/2025-11-25 客户端）；2026-07-28
# 无状态客户端不设置，每请求从 _meta 读版本。
_NEGOTIATED_PROTOCOL_VERSION: str | None = None
# 2025-11-25 客户端在 initialize capabilities.tasks 声明的 tasks 能力（experimental）
_CLIENT_TASKS_CAPABLE = False
_DAEMON: tuple[int, str] | None = None  # (daemon 端口, token) 缓存；host 恒为 DAEMON_HOST 常量


def _request_daemon(method: str, port: int, path: str, *, token: str | None = None,
                    payload: dict[str, Any] | None = None,
                    timeout: float | None = None) -> tuple[int, bytes]:
    """受控回环请求（SSRF 收敛，v3.0）：host 恒为 DAEMON_HOST 常量、port 为
    int、path 必须是以 / 开头的字面量——全链路不构造任何 URL 字符串。
    返回 (status, body_bytes)；连接类异常向上抛给调用方。"""
    assert DAEMON_HOST in ("127.0.0.1", "localhost"), "daemon 仅允许绑定回环"
    if not isinstance(port, int) or not 0 < port < 65536:
        raise ValueError(f"bad daemon port: {port!r}")
    if not isinstance(path, str) or not path.startswith("/"):
        raise ValueError(f"bad daemon path: {path!r}")
    conn = http.client.HTTPConnection(DAEMON_HOST, port,
                                      timeout=timeout or _HTTP_TIMEOUT)
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Auth-Token"] = token
    body = None
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    conn.request(method, path, body=body, headers=headers)
    resp = conn.getresponse()
    data = resp.read()
    status = resp.status
    conn.close()
    return status, data

_DAEMON_PATHS = {
    "spawn_agent": "/api/agents/spawn",
    "send_message": "/api/agents/send_message",
    "steer_agent": "/api/agents/steer",
    "followup_task": "/api/agents/followup",
    "wait_agent": "/api/agents/wait",
    "interrupt_agent": "/api/agents/interrupt",
    "list_agents": "/api/agents/list",
    "get_agent_activity": "/api/agents/activity",
    "get_token_usage": "/api/usage",
    "memory_store": "/api/memory/store",
    "memory_recall": "/api/memory/recall",
    "mailbox_send": "/api/mailbox/send",
    "mailbox_fetch": "/api/mailbox/fetch",
    "consensus_vote": "/api/consensus/vote",
    "policy_list": "/api/policies/list",
    "policy_add": "/api/policies/add",
    "policy_state": "/api/policies/state",
}

TOOLS = [
    {
        "name": "spawn_agent",
        "description": "创建任务 agent 并启动 CLI 子进程（槽位满则排队，返回 status=queued）。"
                       "target_cli 为内置 CLI（claude/grok/opencode/omp/atomcode/codex/kimi/copilot/"
                       "pi/zcode/cline）或用户自定义 CLI（见 docs/custom-cli.md）；context 注入父摘要；"
                       "resume 透传 CLI session id（AtomCode 不支持稳定 session-id resume）。"
                       "返回 agent_id 用于后续监控。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "target_cli": {"type": "string",
                               "enum": _CLI_NAMES,
                               "description": "执行任务的 CLI。"},
                "prompt": {"type": "string", "description": "任务提示词。"},
                "task_name": {"type": "string", "description": "分层名称，如 /root/task1。"},
                "cwd": {"type": "string", "description": "工作目录（必填，daemon 校验）。"},
                "permission_mode": {"type": "string", "enum": ["plan", "acceptEdits", "fullAccess"],
                                    "default": "plan", "description": "CLI 权限模式。"},
                "model": {"type": "string", "description": "CLI 使用的模型。"},
                "context": {"type": "string", "description": "父摘要文本，注入 prompt 前。"},
                "resume": {"type": "string", "description": "要恢复的 CLI session id。"},
                "max_turns": {"type": "integer", "minimum": 1, "maximum": 50,
                              "default": 8,
                              "description": "CLI 最大交互轮数（1–50，默认 8）。"},
                "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 1800,
                                    "description": "任务级超时秒数（1–1800）：到时终止进程树并标记 "
                                                   "incomplete/timeout（可 resume）；不传则不设任务超时。"},
                "parent_agent_id": {"type": "integer", "description": "父 agent（同会话）。"},
                "session_id": {"type": "string", "description": "会话隔离键；缺省用宿主会话。"},
                "context_mode": {"type": "string", "enum": ["full", "compact", "none"],
                                 "default": "compact",
                                 "description": "上下文注入模式（默认 compact：压缩父摘要）。"},
                "summary_chars": {"type": "integer", "minimum": 100, "maximum": 8000,
                                  "default": 600,
                                  "description": "wait_agent terminated 摘要截断字符数（默认 600）。"},
                "return_ref": {"type": "boolean", "default": False,
                               "description": "terminated 时是否返回 ref 引用（含 out_path，默认 false）。"},
                "cache_ttl": {"type": "integer", "minimum": 0, "maximum": 86400,
                              "default": 0,
                              "description": "spawn 缓存存活秒数（0=禁用缓存，默认 0）。"},
                "token_budget": {"type": "integer", "minimum": 0,
                                 "default": 0,
                                 "description": "token 预算上限（0=不限，默认 0）。"},
                "verify_command": {"type": "string",
                                   "description": "完成后验证命令（空=不验证，默认空）。"},
                "downgrade_chain": {
                    "type": "array", "minItems": 1, "maxItems": 5,
                    "items": {
                        "type": "object",
                        "properties": {
                            "cli": {"type": "string", "enum": _CLI_NAMES},
                            "model": {"type": "string"},
                        },
                        "required": ["cli"],
                        "additionalProperties": False,
                    },
                    "description": "B3 可选：用户预声明的跨底座降档链（opt-in）。"
                                    "token_budget 超额时按链逐步提示下一跳组合；"
                                    "不传则沿用同 CLI 降一档的默认行为，系统永不擅自换底座。"},
                "max_fix_attempts": {"type": "integer", "minimum": 0, "maximum": 10,
                                     "default": 0,
                                     "description": "验证失败后自动修复尝试次数（默认 0=不修）。"},
                "env": {"type": "object", "additionalProperties": {"type": "string"},
                        "description": "注入 CLI 子进程的环境变量（merge 到现有环境，同名覆盖）。"},
            },
            "required": ["target_cli", "prompt", "cwd"],
            "additionalProperties": False,
        },
        "annotations": {"destructiveHint": False},
    },
    {
        "name": "orchestrate_task",
        "description": "多 Agent DAG 编排：声明任务图（依赖/cli/worktree/跨厂商审查），"
                       "阻塞执行全部子任务并返回汇总。子任务经 daemon spawn_agent 执行"
                       "（cwd 缺省当前目录；worktree=true 时在独立 git worktree 中运行）。"
                       "review_by 指定不同厂商审查者（同厂商会被拒绝）。"
                       "适用于可拆解的并行/流水线任务；简单任务直接用 spawn_agent。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "tasks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string", "description": "任务节点 id（唯一）。"},
                            "prompt": {"type": "string", "description": "子任务提示词。"},
                            "deps": {"type": "array", "items": {"type": "string"},
                                     "description": "前置任务 id 列表（无则并行）。"},
                            "cli": {"type": "string", "enum": _CLI_NAMES,
                                    "default": "claude", "description": "执行 CLI。"},
                            "worktree": {"type": "boolean", "default": False,
                                         "description": "在独立 git worktree 中运行。"},
                            "review_by": {"type": "string",
                                          "description": "跨厂商审查者 CLI（须与 cli 不同厂商）。"},
                            "max_auto_refine": {"type": "integer", "minimum": 0, "maximum": 5,
                                                "default": 0,
                                                "description": "审查 REJECT 后自动精炼重跑的次数上限（0=不自动精炼）。"},
                            "refine_prompt": {"type": "string",
                                               "description": "自定义精炼提示词前缀，置于审查意见与原始需求之前。"},
                         },
                        "required": ["id", "prompt"],
                        "additionalProperties": False,
                    },
                    "description": "任务图（非空）。",
                },
                "base_dir": {"type": "string",
                             "description": "worktree 创建基准目录（worktree 任务必填）。"},
                "max_workers": {"type": "integer", "minimum": 1, "maximum": 16,
                                "default": 4, "description": "并行度上限。"},
            },
            "required": ["tasks"],
            "additionalProperties": False,
        },
        "annotations": {"destructiveHint": False},
    },
    {
        "name": "policy_list",
        "description": "列出当前生效策略与状态（预算/计数，不含审计日志）。",
        "inputSchema": {"type": "object", "properties": {},
                        "additionalProperties": False},
        "annotations": {"destructiveHint": False},
    },
    {
        "name": "policy_add",
        "description": "运行时注册/覆盖策略（agent 可在会话内配置）。支持内置策略："
                       "budget_policy(limit_usd 美元上限)、approval_policy(allow_prefixes 白名单前缀)、"
                       "tool_limit_policy(max_subtasks/max_parallel)。重复注册同名策略会覆盖。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "enum": ["budget_policy", "approval_policy",
                                                    "tool_limit_policy"],
                         "description": "内置策略名。"},
                "params": {"type": "object",
                           "description": "策略参数：limit_usd / allow_prefixes / max_subtasks / max_parallel。"},
            },
            "required": ["name"],
            "additionalProperties": False,
        },
        "annotations": {"destructiveHint": False},
    },
    {
        "name": "policy_state",
        "description": "策略引擎完整快照（预算/计数/策略链/审计日志）。",
        "inputSchema": {"type": "object", "properties": {},
                        "additionalProperties": False},
        "annotations": {"destructiveHint": False},
    },
    {
        "name": "send_message",
        "description": "投递消息到 daemon 消息队列：运行中返回 delivered，终止后返回 undelivered；"
                       "永不触发执行——只有 followup_task 会把消息合并进新 run。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "integer", "description": "spawn_agent 返回的 agent_id。"},
                "message": {"type": "string", "description": "要投递的消息。"},
            },
            "required": ["agent_id", "message"],
            "additionalProperties": False,
        },
    },
    {
        "name": "steer_agent",
        "title": "Steer running agent",
        "description": "中途插话：若 agent 正在运行，先终止当前 run，再在同一节点立即开始下一 turn；"
                       "支持稳定 session id 的 CLI 自动恢复原会话。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "integer", "description": "要插话的 agent。"},
                "message": {"type": "string", "description": "新的方向或补充要求。"},
            },
            "required": ["agent_id", "message"],
            "additionalProperties": False,
        },
        "annotations": {"destructiveHint": True},
    },
    {
        "name": "followup_task",
        "description": "唯一触发新 turn 的入口：合并该 agent 的挂起消息与 prompt 重新 spawn"
                       "（复用同一 agent 节点）。运行中返回 queued，当前 run 结束后自动串联；"
                       "interrupt=true 先终止再立即重派。返回 merged_messages 计合并条数。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "integer", "description": "要 followup 的 agent。"},
                "prompt": {"type": "string", "description": "新任务提示词。"},
                "target_cli": {"type": "string", "enum": _CLI_NAMES,
                               "description": "可选：跨底座续跑时显式切换执行 CLI"
                                              "（B3 降档链的执行入口；不传沿用原 CLI）。"},
                "model": {"type": "string",
                          "description": "可选：本次 turn 覆盖模型（配合 target_cli 使用）。"},
                "interrupt": {"type": "boolean", "default": False,
                              "description": "先终止运行中的 agent 再重派。"},
                "env": {"type": "object", "additionalProperties": {"type": "string"},
                        "description": "注入 CLI 子进程的环境变量（merge 到现有环境，同名覆盖）。"},
            },
            "required": ["agent_id", "prompt"],
            "additionalProperties": False,
        },
    },
    {
        "name": "wait_agent",
        "description": "单次短阻塞等待 agent 进入终止态（terminated/error/cancelled/incomplete），"
                       f"默认等待 25 秒（不超过 MCP 客户端 ~30s 截断上限）；timeout 上限 {MAX_WAIT_SECONDS:.0f} 秒。"
                       "terminated 返回最新输出摘要（截断）；error 返回错误信息；"
                       "超时返回当前状态 + 存活证据 hint。"
                       "agent 未完成时**循环调用本工具**（每次 timeout 25s）直到终止，"
                       "不要调用 list_agents/get_agent_activity 轮询。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "integer", "description": "spawn_agent 返回的 agent_id。"},
                "timeout": {"type": "integer", "minimum": 1,
                            "maximum": int(MAX_WAIT_SECONDS), "default": 25,
                            "description": f"单次阻塞秒数（默认 25，≤{MAX_WAIT_SECONDS:.0f}）。"},
                "summary_chars": {"type": "integer", "minimum": 100, "maximum": 8000,
                                  "default": 600,
                                  "description": "terminated 摘要截断字符数（默认 600）。"},
                "return_ref": {"type": "boolean", "default": False,
                               "description": "terminated 时是否返回 ref 引用（默认 false）。"},
            },
            "required": ["agent_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "interrupt_agent",
        "description": "终止 agent 的进程树（SIGTERM→SIGKILL）并标记 cancelled（stop_reason=interrupted）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "integer", "description": "要中断的 agent。"},
            },
            "required": ["agent_id"],
            "additionalProperties": False,
        },
        "annotations": {"destructiveHint": True},
    },
    {
        "name": "list_agents",
        "description": "列出 agent 树：id/parent_id/task_name/cli/model/status/stop_reason/updated_at。"
                       "缺省返回当前宿主会话；include_other_sessions=true 时列出所有会话的 agent"
                       "（宿主 MCP 连接重启后找回旧 agent 状态用）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "session_id": {"type": "string", "description": "会话过滤；缺省当前会话。"},
                "include_other_sessions": {"type": "boolean", "default": False,
                                           "description": "列出所有会话的 agent（含旧会话）。"},
                "fields": {"type": "string", "enum": ["default", "all"], "default": "default",
                           "description": "返回字段裁剪（default=轻量四字段，all=全量）。"},
            },
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "get_agent_activity",
        "description": "agent 的实时活动流（规范化事件按 seq 排序）。since_seq 用于增量拉取，"
                       "返回 events + next_seq。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "integer"},
                "since_seq": {"type": "integer", "minimum": 0, "default": 0,
                              "description": "只返回 seq 更大的事件。"},
                "include": {"type": "string", "enum": ["default", "verbose"], "default": "default",
                            "description": "default=压缩已消费 payload，verbose=返全量。"},
            },
            "required": ["agent_id"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "get_token_usage",
        "description": "token 统计（派发侧估算，estimated=true）：agent_id 指定单 agent；"
                       "缺省聚合会话（session_id 过滤）或全局。返回四字段 tokens + cost_usd。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "integer", "description": "指定单 agent 的 usage。"},
                "session_id": {"type": "string", "description": "缺省 agent_id 时按会话过滤。"},
            },
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "estimate_complexity",
        "title": "Estimate task complexity",
        "description": "复杂度分级门（本地直算，零 token，不 spawn）：把任务判为 S/M/L 三级并给理由。"
                       "S（单文件/≤2 处/无并行价值）→ 主 agent 直接做不派发；"
                       "M（跨 2-3 文件、顺序依赖）→ 至多 1 个子任务；"
                       "L（>3 文件/可并行/需专精角色/上下文超窗）→ 走完整编排。"
                       "依据：文件数 + 文本信号（并行/重构/架构/安全/迁移等关键词 + 强依赖特征）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "task": {"type": "string", "description": "任务描述（一句话目标或完整需求）。"},
                "files": {"type": "array", "items": {"type": "string"},
                          "description": "预计涉及的文件路径清单；缺省时从 task 文本提取文件特征。"},
            },
            "required": ["task"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "memory_store",
        "description": "写一条项目记忆（记忆银行，零依赖 SQLite）。content 必填；"
                       "kind 为 decision/lesson/convention/final_answer（默认 lesson）；"
                       "key 可选键名，tags 为空格分隔标签串；session_id 缺省当前会话（同会话隔离）。"
                       "适合沉淀决策、经验教训、约定等供后续 memory_recall 召回。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "记忆正文（必填）。"},
                "kind": {"type": "string",
                         "enum": ["decision", "lesson", "convention", "final_answer"],
                         "default": "lesson",
                         "description": "记忆类型（默认 lesson）。"},
                "key": {"type": "string", "description": "可选键名，便于精确召回。"},
                "tags": {"type": "string", "description": "可选标签串（空格分隔），参与关键词检索。"},
                "session_id": {"type": "string", "description": "会话隔离键；缺省用宿主会话。"},
            },
            "required": ["content"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": False},
    },
    {
        "name": "memory_recall",
        "description": "检索项目记忆：query 关键词 LIKE 命中 content/key/tags（中文场景比 FTS5 可靠），"
                       "可按 kind 过滤，按时间倒序，limit 截断（默认 5，上限 20）；"
                       "仅返回同 session 的记忆（隔离）。返回 memories 列表，每条含 "
                       "id/kind/key/content/tags/created_at/source。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "关键词；缺省返回该 session 最近记忆。"},
                "kind": {"type": "string",
                         "enum": ["decision", "lesson", "convention", "final_answer"],
                         "description": "按类型过滤；缺省不过滤。"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5,
                          "description": "返回条数上限（默认 5，最大 20）。"},
                "session_id": {"type": "string", "description": "会话隔离键；缺省用宿主会话。"},
            },
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "mailbox_send",
        "description": "Agent 间点对点/广播信箱：发送消息或协同指令到指定 team/agent。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "team": {"type": "string", "description": "团队隔离标识（默认 default）。"},
                "from_agent_id": {"type": "integer", "description": "发送者 Agent ID。"},
                "to_agent_id": {"type": "integer", "description": "接收者 Agent ID（空则为广播）。"},
                "message": {"type": "string", "description": "消息正文。"},
                "msg_type": {"type": "string", "description": "消息类型（message/proposal/artifact）。"},
                "payload": {"type": "object", "description": "可选结构化载荷。"},
            },
            "required": ["message"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": False},
    },
    {
        "name": "mailbox_fetch",
        "description": "收取信箱消息：按团队与 Agent ID 获取未读/历史消息。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "team": {"type": "string", "description": "团队隔离标识（默认 default）。"},
                "agent_id": {"type": "integer", "description": "收取者 Agent ID（空则获取广播）。"},
                "unread_only": {"type": "boolean", "default": True, "description": "是否仅收取未读消息。"},
                "limit": {"type": "integer", "default": 20, "description": "拉取条数上限。"},
            },
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "consensus_vote",
        "description": "团队共识投票：发起提案、投票表决或结算统计票数。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "team": {"type": "string", "description": "团队隔离标识。"},
                "from_agent_id": {"type": "integer", "description": "投票者 Agent ID。"},
                "action": {"type": "string", "enum": ["propose", "vote", "tally"], "description": "动作类型。"},
                "proposal": {"type": "string", "description": "提案内容（action=propose 时必填）。"},
                "vote": {"type": "boolean", "description": "赞成(true)或反对(false)（action=vote 时填）。"},
                "reason": {"type": "string", "description": "投票理由。"},
            },
            "required": ["team", "action"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": False},
    },
]


def send(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


# ---- 本地直算工具（零 token、不走 daemon、不 spawn）----

# 复杂度分级信号（与 skill/SKILL.md 第零步分级门同口径）
_L_COMPLEXITY_HINTS = ("并行", "parallel", "重构", "refactor", "架构", "architect",
                       "安全审查", "security review", "迁移", "migrat", "全库",
                       "跨模块", "多文件", "audit")
_S_COMPLEXITY_HINTS = ("快速问答", "小改", "一行", "quick fix", "简单修复", "单文件",
                       "微调", "tweak")
_FILE_RE = re.compile(r"(?:^|[\s,，、/])([\w./\\-]+\.(?:py|ts|js|go|rs|java|md|json))")
_L_HINT_RE = re.compile("|".join(map(re.escape, _L_COMPLEXITY_HINTS)), re.IGNORECASE)
_S_HINT_RE = re.compile("|".join(map(re.escape, _S_COMPLEXITY_HINTS)), re.IGNORECASE)


def _estimate_complexity(arguments: dict[str, Any]) -> dict[str, Any]:
    """复杂度分级门：把任务判为 S/M/L 并给理由与建议。

    判据（确定性，不调 LLM）：
    - 显式 files 数量 >3 → L；2–3 个 → M；≤1 个 → 看文本信号
    - 文本信号：L 关键词（并行/重构/架构/安全/迁移/全库…）→ L；
      S 关键词（快速问答/小改/一行/单文件…）→ S；
      文件路径特征计数兜底
    """
    task = str(arguments.get("task") or "").strip()
    raw_files = arguments.get("files")
    files: list[str] = []
    if isinstance(raw_files, list):
        files = [str(f) for f in raw_files if str(f).strip()]
    elif isinstance(raw_files, str):
        files = [f.strip() for f in raw_files.replace("，", ",").split(",") if f.strip()]

    signals: list[str] = []
    n_files = len(files)
    if n_files > 3:
        signals.append(f"显式文件数 {n_files} > 3（跨文件改动）")
    elif n_files >= 2:
        signals.append(f"显式文件数 {n_files}（2–3 个，中等规模）")
    elif n_files == 1:
        signals.append("单文件改动")

    if not signals:
        # 无显式 files：从任务文本提取文件路径特征兜底
        text_files = sorted(set(_FILE_RE.findall(task)))
        n_files = max(n_files, len(text_files))
        if text_files:
            signals.append(f"文本提到 {len(text_files)} 个文件路径特征")

    l_hits = sorted(set(_L_HINT_RE.findall(task)))
    s_hits = sorted(set(_S_HINT_RE.findall(task)))
    if l_hits:
        signals.append(f"L 信号: {'/'.join(l_hits)}")
    if s_hits:
        signals.append(f"S 信号: {'/'.join(s_hits)}")

    if n_files > 3 or l_hits:
        level = "L"
        suggestion = ("走完整编排五步：可并行分支/需专精角色（架构、安全审查）/上下文超窗时才拆；"
                      "否则按依赖串行，避免为拆而拆")
        delegate = n_files > 3 or any(k in l_hits for k in ("并行", "parallel", "audit", "安全审查"))
    elif n_files <= 1 and (s_hits or not l_hits):
        level = "S"
        suggestion = "主 agent 直接做，不 spawn（子代理启动/简报/汇合开销 > 实现收益）"
        delegate = False
    else:
        level = "M"
        suggestion = ("至多拆 1 个子任务（读密集探索可拆，写密集尽量自做）；"
                      "需要同一心智模型的步骤合并，不硬拆")
        delegate = n_files >= 2

    rationale = "；".join(signals) if signals else "无显著信号（按最小路径处理）"
    return {
        "level": level,
        "rationale": rationale,
        "signals": signals,
        "files": files,
        "delegate": delegate,
        "suggestion": suggestion,
    }


def _daemon_spawner(prompt: str, cli: str, cwd: str | None) -> int:
    """编排 spawner：转调 daemon spawn_agent，返回 agent_id。"""
    payload = {
        "target_cli": cli,
        "prompt": prompt,
        "cwd": cwd or os.getcwd(),
        "permission_mode": "plan",
        "max_turns": 8,
        "session_id": _session_id(),
    }
    resp = _daemon_post("/api/agents/spawn", payload)
    agent_id = resp.get("agent_id") if isinstance(resp, dict) else None
    if agent_id is None:
        raise RuntimeError(f"spawn 失败: {resp}")
    return int(agent_id)


def _daemon_waiter(agent_id: int) -> dict[str, Any]:
    """编排 waiter：循环 wait_agent 直至终止态（单次 25s，总预算由外层控制）。"""
    deadline = time.monotonic() + 600.0
    backoff = 0.1
    while time.monotonic() < deadline:
        resp = _daemon_post("/api/agents/wait", {
            "agent_id": agent_id, "timeout": 25, "session_id": _session_id(),
        }, http_timeout=_HTTP_TIMEOUT + 25)
        status = str((resp or {}).get("status") or "running")
        if status in ("terminated", "error", "cancelled", "incomplete"):
            return {"status": status, "summary": str((resp or {}).get("summary") or "")}
        time.sleep(backoff)
        backoff = min(2.0, backoff * 2.0)
    return {"status": "incomplete",
            "summary": "编排等待超时（600s）。可继续 wait_agent 等待或 followup_task 续接。"}


def _orchestrate_task(arguments: dict[str, Any]) -> dict[str, Any]:
    """DAG 编排入口：声明任务图（含依赖/CLI/worktree/跨厂商审查），
    阻塞执行全部子任务并返回汇总。tasks 元素：
    {id, prompt, deps?, cli?, worktree?, review_by?}。"""
    raw_tasks = arguments.get("tasks")
    if not isinstance(raw_tasks, list) or not raw_tasks:
        return {"valid": False, "failed": ["tasks 必须为非空数组"], "done": [],
                "tasks": []}
    orch = Orchestrator(spawner=_daemon_spawner, waiter=_daemon_waiter,
                        base_dir=arguments.get("base_dir"),
                        max_workers=int(arguments.get("max_workers") or 4))
    for raw in raw_tasks:
        if not isinstance(raw, dict) or not raw.get("id") or not raw.get("prompt"):
            return {"valid": False, "failed": [f"任务项缺失 id/prompt: {raw}"],
                    "done": [], "tasks": []}
        orch.add_task(OrchestratedTask(
            task_id=str(raw["id"]),
            prompt=str(raw["prompt"]),
            deps=[str(d) for d in (raw.get("deps") or [])],
            cli=str(raw.get("cli") or "claude"),
            worktree=bool(raw.get("worktree")),
            review_by=str(raw["review_by"]) if raw.get("review_by") else None,
            max_retries=int(raw.get("max_auto_refine") or raw.get("max_retries") or 0),
            refinement_prompt=str(raw["refine_prompt"]) if raw.get("refine_prompt") else None,
        ))
    result = orch.run()
    # 落盘 worktree 注册表（网页工作区面板消费）：只记 worktree 任务
    if result.get("valid") and any(
            t.get("worktree_path") for t in result.get("tasks", [])):
        _persist_workspaces(result["tasks"], orch.base_dir)
    return result


def _persist_workspaces(tasks: list[dict[str, Any]], base_dir: str | None) -> None:
    """把编排产生的 worktree 写入 <state_dir>/workspaces.json。

    状态语义（M1 修复）：任务 done 不代表已合并——worktree 仍存在且分支未合并，
    标 clean（任务完成）；dirty（未完成/失败）。合并动作由网页面板 merge 按钮触发。"""
    workspaces = []
    for t in tasks:
        path = t.get("worktree_path") or ""
        if not path:
            continue
        workspaces.append({
            "id": t.get("task_id"),
            "path": path,
            "status": "clean" if t.get("status") == "done" else "dirty",
            "branch": f"agent-{t.get('task_id')}",
            "task": (t.get("prompt") or "")[:120],
            "base_dir": base_dir or "",
        })
    if not workspaces:
        return
    state_dir = state_dir_from_env()
    state_dir.mkdir(parents=True, exist_ok=True)
    ws_file = state_dir / "workspaces.json"
    existing: dict[str, Any] = {}
    if ws_file.is_file():
        try:
            existing = json.loads(ws_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            existing = {}
    registry = existing.get("workspaces") or []
    by_id = {w.get("id"): w for w in registry}
    for w in workspaces:
        by_id[w["id"]] = w
    merged = {"workspaces": list(by_id.values())}
    tmp = ws_file.with_suffix(".tmp")
    tmp.write_text(json.dumps(merged, ensure_ascii=False,
                              separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, ws_file)


# 本地工具注册表：name → (实现, 是否常驻保留)
_LOCAL_TOOLS: dict[str, Any] = {
    "estimate_complexity": _estimate_complexity,
    "orchestrate_task": _orchestrate_task,
}


def result(request_id: Any, payload: dict[str, Any], *, is_error: bool = False,
           modern: bool = False) -> dict[str, Any]:
    value: dict[str, Any] = {
        "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}],
        "isError": is_error,
    }
    if modern:
        value["resultType"] = "complete"
        value["structuredContent"] = payload
        value["_meta"] = {"io.modelcontextprotocol/serverInfo": {
            "name": "agent-mcp", "version": SERVER_VERSION}}
    return {"jsonrpc": "2.0", "id": request_id, "result": value}


def rpc_error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _request_protocol(request: dict[str, Any]) -> str | None:
    """2026-07-28 无状态协议：请求的 _meta 携带协议版本（每请求声明）。"""
    params = request.get("params")
    meta = params.get("_meta") if isinstance(params, dict) else None
    if not isinstance(meta, dict):
        return None
    version = meta.get("io.modelcontextprotocol/protocolVersion")
    return str(version) if version else None


def _negotiate_version(request: dict[str, Any]) -> str:
    """initialize 顶层 protocolVersion → 会话协商版本（2025-03-26/2025-11-25 客户端）。

    客户端请求版本在支持集内则回显该版本；否则回 legacy 兜底（SDK 客户端会接受
    服务端回显的任何受支持版本，不能像 _meta 无状态方式那样直接报错拒绝）。
    会话版本记录在进程级 _NEGOTIATED_PROTOCOL_VERSION，供后续请求复用（stdio 单连接进程）。
    """
    global _NEGOTIATED_PROTOCOL_VERSION
    params = request.get("params")
    requested = params.get("protocolVersion") if isinstance(params, dict) else None
    if isinstance(requested, str) and requested:
        _NEGOTIATED_PROTOCOL_VERSION = (
            requested if requested in SUPPORTED_PROTOCOL_VERSIONS else LEGACY_PROTOCOL_VERSION)
    return _NEGOTIATED_PROTOCOL_VERSION or LEGACY_PROTOCOL_VERSION


def _effective_version(request: dict[str, Any]) -> str | None:
    """请求生效的协议版本：2026-07-28 客户端用 _meta 声明；否则用 initialize 协商的会话版本。"""
    meta_version = _request_protocol(request)
    if meta_version is not None:
        return meta_version
    return _NEGOTIATED_PROTOCOL_VERSION


def _modern_meta() -> dict[str, Any]:
    return {"io.modelcontextprotocol/serverInfo": {
        "name": "agent-mcp", "version": SERVER_VERSION}}


# D5 静态裁剪保留集：永不下裁的通用工具，主 agent 任何场景都可能用
_TOOL_PRUNE_KEEP = {"spawn_agent", "wait_agent", "interrupt_agent", "estimate_complexity"}


def _pruned_tools(request: dict[str, Any]) -> list[dict[str, Any]]:
    """工具列表：默认返回全量 TOOLS；仅当 2026-07-28 无状态客户端在请求 _meta 的
    clientCapabilities.extensions 里显式声明用过/需要的工具名时才按声明裁剪。

    2025-03-26/2025-11-25 客户端（initialize 握手式，含 DSH 的 SDK 1.29.0）不发送
    clientCapabilities extensions，一律返回全量——保证 DSH 工具目录完整可见。
    """
    params = request.get("params")
    meta = params.get("_meta") if isinstance(params, dict) else None
    caps = (meta.get("io.modelcontextprotocol/clientCapabilities")
            if isinstance(meta, dict) else None)
    exts = caps.get("extensions") if isinstance(caps, dict) else None
    # client 声明用过的工具名（2026-07-28 custom capability extension 约定）
    declared = set()
    if isinstance(exts, dict):
        for key in ("io.modelcontextprotocol/agent-mcp.tools",
                    "io.modelcontextprotocol/tools"):
            v = exts.get(key)
            if isinstance(v, dict):
                names = v.get("used") or v.get("names")
                if isinstance(names, list):
                    declared.update(str(n) for n in names)
    if not declared:
        return list(TOOLS)
    kept = [t for t in TOOLS
            if t.get("name") in _TOOL_PRUNE_KEEP or t.get("name") in declared]
    return kept or list(TOOLS)


def _modern_discover() -> dict[str, Any]:
    return {
        "resultType": "complete",
        "supportedVersions": list(SUPPORTED_PROTOCOL_VERSIONS),
        "capabilities": {"tools": {"listChanged": False}, "extensions": {
            "io.modelcontextprotocol/tasks": {}}},
        "_meta": _modern_meta(),
        "instructions": "派发和恢复长任务；steer_agent 用于中途改向，followup_task 用于继续会话。",
        "ttlMs": 300_000,
        "cacheScope": "public",
    }


def _unsupported_version(request_id: Any, requested: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {
        "code": -32022, "message": "Unsupported protocol version",
        "data": {"supported": SUPPORTED_PROTOCOL_VERSIONS, "requested": requested}}}



def _tasks_supported(request: dict[str, Any]) -> bool:
    """tasks 客户端能力：2026-07-28 无状态客户端在请求 _meta 的
    clientCapabilities.extensions 声明 io.modelcontextprotocol/tasks；
    2025-11-25 客户端在 initialize 的 capabilities.tasks 声明（会话级记录）。"""
    params = request.get("params")
    meta = params.get("_meta") if isinstance(params, dict) else None
    caps = meta.get("io.modelcontextprotocol/clientCapabilities") if isinstance(meta, dict) else None
    exts = caps.get("extensions") if isinstance(caps, dict) else None
    return isinstance(exts, dict) and "io.modelcontextprotocol/tasks" in exts \
        or _CLIENT_TASKS_CAPABLE


def _agent_id_from_task(params: dict[str, Any]) -> int:
    task_id = str(params.get("taskId") or "")
    if not task_id.startswith("agent:"):
        raise ValueError("invalid taskId")
    return int(task_id.split(":", 1)[1])


def _task_status(payload: dict[str, Any]) -> str:
    status = payload.get("status")
    # B5：needs_advisor（子代理回 NEEDS_DECISION）升为协议级 input_required，
    # 与 tasks/update 的 inputResponses→steer_agent 形成双向闭环
    return {"running": "working", "queued": "working", "terminated": "completed",
            "error": "failed", "cancelled": "cancelled", "incomplete": "failed",
            "needs_advisor": "input_required"}.get(status, "working")


def _task_result(payload: dict[str, Any], *, result_type: str = "complete") -> dict[str, Any]:
    """任务对象（2025-11-25 tasks / 2026-07-28 tasks 扩展共用）。

    字段名对齐官方 schema：ttl（number|null）、pollInterval（number）、
    createdAt/lastUpdatedAt（ISO 字符串）；resultType 遵循 2026-07-28 枚举
    （complete/input_required）——spawn 的任务句柄与 tasks/get 的最终结果一致用 complete。
    """
    agent_id = int(payload["agent_id"])
    created = str(payload.get("created_at") or payload.get("updated_at") or "")
    updated = str(payload.get("updated_at") or created)
    task: dict[str, Any] = {
        "resultType": result_type,
        "taskId": f"agent:{agent_id}",
        "status": _task_status(payload),
        "createdAt": created,
        "lastUpdatedAt": updated,
        "ttl": 604_800_000,
        "pollInterval": 1000,
        "_meta": _modern_meta(),
    }
    if task["status"] == "completed":
        task["result"] = {"resultType": "complete", "content": [{"type": "text",
            "text": json.dumps(payload, ensure_ascii=False)}], "isError": False}
    elif task["status"] == "input_required":
        # B5：把需要决策的问题透出给 host，等待 tasks/update(inputResponses)
        question = ""
        summary = str(payload.get("summary") or "")
        marker = "NEEDS_DECISION:"
        if marker in summary:
            question = summary.split(marker, 1)[1].strip()
        task["result"] = {"resultType": "input_required",
                          "content": [{"type": "text",
                                       "text": question or str(payload.get("stop_reason") or
                                                               "agent needs decision")}],
                          "isError": False}
    elif task["status"] == "failed":
        task["error"] = {"code": -32010, "message": payload.get("message") or
                         payload.get("stop_reason") or "agent failed", "data": payload}
    return task


def _task_error(request_id: Any, payload: dict[str, Any]) -> dict[str, Any]:
    summary = str(payload.get("summary") or payload.get("message") or "daemon request failed")
    code = -32602 if int(payload.get("http_status") or 500) in (400, 404) else -32603
    return rpc_error(request_id, code, summary)


def _accepted_input_text(input_responses: Any) -> str:
    if not isinstance(input_responses, dict):
        return ""
    for response in input_responses.values():
        if not isinstance(response, dict) or response.get("action") != "accept":
            continue
        content = response.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
        if isinstance(content, dict):
            for key in ("message", "input", "text", "value"):
                value = content.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
            if content:
                return json.dumps(content, ensure_ascii=False)
    return ""

def host_from_client_info(info: dict[str, Any] | None) -> str:
    """clientInfo.name → host（codex/claude/omp/unknown），子串匹配。"""
    name = str((info or {}).get("name") or "").lower()
    if "codex" in name:
        return "codex"
    if "claude" in name:
        return "claude"
    if "omp" in name:
        return "omp"
    return "unknown"

def _probe_legacy_daemon(port: int, token: str) -> bool:
    """Authenticate a legacy daemon whose public health payload lacks identity fields."""
    if not token:
        return False
    try:
        status, data = _request_daemon(
            "POST", port, "/api/agents/list", token=token,
            payload={"session_id": "agent-mcp-compatibility-probe"}, timeout=1)
    except Exception:
        return False
    if status != 200:
        return False
    body = json.loads(data.decode("utf-8"))
    return isinstance(body, dict) and isinstance(body.get("agents"), list)


def _probe(port: int) -> bool:
    token = _read_token()
    try:
        status, data = _request_daemon("GET", port, "/health", timeout=1)
    except Exception:
        return False
    if status != 200:
        return False
    body = json.loads(data.decode("utf-8"))
    if body.get("service") == "agent-mcp-daemon":
        fingerprint = body.get("token_sha256")
        expected = hashlib.sha256(token.encode("utf-8")).hexdigest() if token else ""
        return bool(expected and fingerprint == expected)
    if body.get("ok") is True and body.get("version") == 1:
        return _probe_legacy_daemon(port, token)
    return False


def _read_token() -> str:
    try:
        token = json.loads(DAEMON_JSON.read_text(encoding="utf-8")).get("token", "")
        return token if isinstance(token, str) and token else ""
    except (OSError, json.JSONDecodeError):
        return ""


def _ensure_token_file() -> str:
    """daemon.json 缺 token 时生成（0600）；daemon 启动时复用同一文件。"""
    token = _read_token()
    if not token:
        token = uuid.uuid4().hex
        DAEMON_JSON.parent.mkdir(parents=True, exist_ok=True)
        DAEMON_JSON.write_text(json.dumps({"token": token}), encoding="utf-8")
        if os.name != "nt":
            os.chmod(DAEMON_JSON, 0o600)
    return token


def _spawn_detached(command: list[str], *, env: dict[str, str] | None = None) -> None:
    """跨平台分离启动 daemon（薄层零依赖，不复用 agent_mcp.dispatch 的 psutil 路径）。

    stderr 落盘到 state_dir/daemon.err.log（而非 DEVNULL），daemon 内部
    print 诊断（ingest 失败等）可事后排查；stdout 仍丢弃。
    """
    err_log = STATE_DIR / "daemon.err.log"
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        err_fh = err_log.open("a", encoding="utf-8")
    except Exception:
        err_fh = subprocess.DEVNULL
    kwargs: dict[str, Any] = dict(env=env, stdin=subprocess.DEVNULL,
                                  stdout=subprocess.DEVNULL, stderr=err_fh)
    if os.name == "nt":
        kwargs["creationflags"] = (subprocess.CREATE_NEW_PROCESS_GROUP
                                   | getattr(subprocess, "DETACHED_PROCESS", 0))
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen(command, **kwargs)
    if err_fh is not subprocess.DEVNULL:
        err_fh.close()


_STARTUP_LOCK = threading.Lock()


def ensure_daemon() -> tuple[int, str]:
    """原子拉起：探测 /health（10×0.5s）→ 无则补 token 文件 → spawn_detached(daemon_main)
    → 轮询 /health。锁文件残留校验在 daemon_main 内部，薄层不重复。返回 (daemon 端口, token)。
    进程级 _STARTUP_LOCK 串行化探测+拉起：多线程并发调用只拉起一个 daemon。"""
    with _STARTUP_LOCK:
        token = _read_token()
        spawned = False
        for _ in range(_PROBE_ATTEMPTS):
            if _probe(DAEMON_PORT):
                return DAEMON_PORT, token
            if not spawned:
                token = _ensure_token_file()
                _spawn_detached([sys.executable, str(DAEMON_SCRIPT),
                                 "--port", str(DAEMON_PORT), "--state-dir", str(STATE_DIR)])
                spawned = True
            time.sleep(_PROBE_INTERVAL)
        raise RuntimeError(f"agent-mcp daemon failed to start on "
                           f"{DAEMON_HOST}:{DAEMON_PORT} within "
                           f"{_PROBE_ATTEMPTS * _PROBE_INTERVAL:.0f}s")


def _host_session_key() -> str | None:
    """宿主注入的稳定会话标识（claude/codex resume 时保持同一值）；无则 None。"""
    for var in _HOST_SESSION_ENV_VARS:
        value = os.environ.get(var)
        if value:
            return value
    return None


def _session_id_file() -> Path:
    """按 host 分文件的持久化 session 文件（session-id-<host>）：不同宿主互不共享。"""
    return Path(f"{SESSION_ID_PREFIX}-{_HOST}")


def _persisted_session_key() -> str:
    """无宿主标识时按 host 持久化兜底：同一 host 的 MCP 进程共享同一 session id（重启不变）。"""
    path = _session_id_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        value = path.read_text(encoding="utf-8").strip()
        if value:
            return value
    value = uuid.uuid4().hex
    path.write_text(value, encoding="utf-8")
    return value


def _session_id() -> str:
    global _SESSION_ID
    if _SESSION_ID is None:
        key = _host_session_key() or _persisted_session_key()
        _SESSION_ID = f"{_HOST}-{key}"
    return _SESSION_ID


def _http_error_payload(code: int, detail: str) -> dict[str, Any]:
    """daemon 的 HTTP 错误 → 结构化错误；session 不匹配给出可执行指引，
    避免宿主拿到通用 hint 后无路可走（echo 空转）。
    P5: error_type 字段映射，便主 agent 自动化错误分流。"""
    hint = detail
    try:
        hint = json.loads(detail).get("error") or detail
    except json.JSONDecodeError:
        pass
    # P5: error_type 映射
    error_type = "daemon_error"
    next_actions = ["check the arguments and the daemon log"]
    if SESSION_MISMATCH_MARK in hint:
        error_type = "session_mismatch"
        next_actions = ["the agent belongs to another session (host MCP connection "
                        "restarted); do NOT reuse this agent_id — spawn a NEW agent "
                        "in the current session and pass the prior context in the prompt"]
    elif "daemon unreachable" in hint or "connection refused" in hint.lower():
        error_type = "daemon_unreachable"
        next_actions = ["the daemon is not running or not responding; "
                        "wait for auto-restart or manually start it "
                        "(python agent_mcp/daemon_main.py)"]
    elif "port" in hint.lower() and ("conflict" in hint.lower() or "in use" in hint.lower()):
        error_type = "port_conflict"
        next_actions = ["the daemon port is already in use; stop the conflicting "
                        "process or remove the stale socket/port lock"]
    return {"status": "error", "summary": f"daemon returned HTTP {code}: {hint}",
            "error_type": error_type,
            "root_cause_hint": detail or None,
            "next_actions": next_actions}


def _post_once(port: int, token: str, path: str, payload: dict[str, Any],
               http_timeout: float | None = None) -> dict[str, Any] | None:
    """单次 HTTP POST；连接失败返回 None（触发重拉），HTTP 错误转结构化错误。
    http_timeout 缺省用 _HTTP_TIMEOUT；wait_agent 会按请求的 timeout 叠加余量。"""
    try:
        status, data = _request_daemon("POST", port, path, token=token,
                                       payload=payload,
                                       timeout=http_timeout or _HTTP_TIMEOUT)
    except (OSError, TimeoutError, http.client.HTTPException):
        return None
    if status != 200:
        return _http_error_payload(status, data.decode("utf-8", "replace")[:400])
    return json.loads(data.decode("utf-8")) if data else {}


def _daemon_post(path: str, payload: dict[str, Any],
                 http_timeout: float | None = None) -> dict[str, Any]:
    """调用 daemon；连接失败先失效缓存重新拉起，再重试一次。

    所有 ensure_daemon() 路径均被 try/except RuntimeError 包裹，
    避免未保护的异常传播到 handle() → main() 导致进程退出、stdin pipe 关闭
    （表现为 MCP 客户端 "Transport closed"）。
    """
    global _DAEMON
    if _DAEMON is None:
        try:
            _DAEMON = ensure_daemon()
        except RuntimeError as exc:
            print(f"agent-mcp: daemon unreachable: {exc}", file=sys.stderr)
            return {"status": "error", "summary": "agent-mcp daemon is not reachable",
                    "root_cause_hint": str(exc),
                    "next_actions": ["start the daemon manually: "
                                     "python agent_mcp/daemon_main.py"]}
    port, token = _DAEMON
    out = _post_once(port, token, path, payload, http_timeout=http_timeout)
    if out is not None:
        return out
    _DAEMON = None  # daemon 可能已退出，重新拉起
    try:
        port, token = ensure_daemon()
    except RuntimeError as exc:
        print(f"agent-mcp: daemon still unreachable: {exc}", file=sys.stderr)
        return {"status": "error", "summary": "agent-mcp daemon is not reachable",
                "root_cause_hint": str(exc),
                "next_actions": ["start the daemon manually: "
                                 "python agent_mcp/daemon_main.py"]}
    out = _post_once(port, token, path, payload, http_timeout=http_timeout)
    if out is None:
        return {"status": "error", "summary": "agent-mcp daemon unreachable after relaunch",
                "root_cause_hint": "daemon started but connection failed",
                "next_actions": ["check for port conflicts on the daemon port"]}
    return out


def call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    # 策略 enforcement 位于 daemon（spawn/usage 数据源同进程，H1/H2 修复）：
    # spawn/steer/orchestrate 由 daemon Dispatcher.spawn 拦截；这里不再本地评估。
    # 本地直算工具（零 token、不 spawn、不走 daemon）：estimate_complexity 等
    local = _LOCAL_TOOLS.get(name)
    if local is not None:
        return local(arguments)
    path = _DAEMON_PATHS.get(name)
    if path is None:
        raise ValueError(f"unknown tool: {name}")
    payload = dict(arguments)
    if name == "list_agents" and payload.pop("include_other_sessions", False):
        # 跨会话找回：session_id 置 None → daemon 返回所有会话的 agent
        payload["session_id"] = None
    else:
        payload.setdefault("session_id", _session_id())
    # wait_agent 阻塞时长可自定义（上限 MAX_WAIT_SECONDS）：HTTP 层超时同步叠加余量，
    # 避免 daemon 仍在等待时 MCP→daemon 请求先被 _HTTP_TIMEOUT 掐断。
    http_timeout: float | None = None
    if name == "wait_agent":
        # 默认 25s（≤ MCP 客户端 ~30s 截断上限），避免长轮询被宿主截断
        wait = min(max(float(payload.get("timeout") or 25), 1), MAX_WAIT_SECONDS)
        http_timeout = _HTTP_TIMEOUT + wait
    return _daemon_post(path, payload, http_timeout=http_timeout)


def handle(request: dict[str, Any], *, emit=send) -> None:
    request_id = request.get("id")
    method = request.get("method")
    # 2026-07-28 无状态客户端：每请求 _meta 声明版本，不匹配即拒绝（UnsupportedProtocolVersion）
    meta_version = _request_protocol(request)
    if meta_version is not None and meta_version not in SUPPORTED_PROTOCOL_VERSIONS:
        emit(_unsupported_version(request_id, meta_version))
        return
    if method == "server/discover":
        emit({"jsonrpc": "2.0", "id": request_id, "result": _modern_discover()})
        return
    if method == "initialize":
        global _HOST, _CLIENT_TASKS_CAPABLE
        params = request.get("params")
        if not isinstance(params, dict):
            params = {}
        _HOST = host_from_client_info(params.get("clientInfo"))
        # 2025-11-25 客户端在 capabilities.tasks 声明 tasks 能力（experimental）
        capabilities = params.get("capabilities")
        _CLIENT_TASKS_CAPABLE = isinstance(
            capabilities.get("tasks"), dict) if isinstance(capabilities, dict) else False
        # 顶层 protocolVersion 协商：2025-03-26/2025-11-25 客户端（含 DSH SDK 1.29.0）。
        # 请求版本在支持集内则回显；否则回 legacy 兜底（绝不回 2026-07-28——
        # SDK 客户端只接受 SUPPORTED_PROTOCOL_VERSIONS 内版本）。
        negotiated = _negotiate_version(request)
        emit({"jsonrpc": "2.0", "id": request_id, "result": {
            "protocolVersion": negotiated,
            "serverInfo": {"name": "agent-mcp", "version": SERVER_VERSION},
            "capabilities": {
                "tools": {"listChanged": False},
                "resources": {"subscribe": False, "listChanged": False},
                "prompts": {"listChanged": False}
            }},
        })
        return
    # modern = 2025-11-25 或 2026-07-28（structuredContent/resultType/tasks 生效）；
    # legacy 客户端（2025-03-26 无顶层版本）保持原行为。
    modern = _effective_version(request) in (MODERN_PROTOCOL_VERSION, BRIDGE_PROTOCOL_VERSION)
    if method == "tools/list":
        # legacy/2025-11-25 客户端无 _meta capability 声明 → 默认返回全量工具
        listed: dict[str, Any] = {"tools": _pruned_tools(request)}
        if modern:
            listed.update({"resultType": "complete", "ttlMs": 300_000,
                           "cacheScope": "public", "_meta": _modern_meta()})
        emit({"jsonrpc": "2.0", "id": request_id, "result": listed})
    elif method == "resources/list":
        res_list = [
            {"uri": "agent-mcp://agents/status", "name": "Agents Status", "mimeType": "application/json"},
            {"uri": "agent-mcp://policies/current", "name": "Active Policies", "mimeType": "application/json"},
            {"uri": "agent-mcp://stats/tokens", "name": "Token Usage Stats", "mimeType": "application/json"}
        ]
        emit({"jsonrpc": "2.0", "id": request_id, "result": {"resources": res_list}})
    elif method == "resources/read":
        params = request.get("params") or {}
        uri = params.get("uri", "")
        if uri == "agent-mcp://agents/status":
            data = call_tool("list_agents", {})
        elif uri == "agent-mcp://policies/current":
            data = call_tool("policy_list", {})
        elif uri == "agent-mcp://stats/tokens":
            data = call_tool("get_token_usage", {})
        else:
            emit(rpc_error(request_id, -32602, f"Resource not found: {uri}"))
            return
        emit({"jsonrpc": "2.0", "id": request_id, "result": {
            "contents": [{"uri": uri, "mimeType": "application/json", "text": json.dumps(data, ensure_ascii=False)}]
        }})
    elif method == "prompts/list":
        prompt_list = [
            {
                "name": "dag_orchestration",
                "description": "Template for multi-agent DAG task orchestration",
                "arguments": [{"name": "task", "description": "High level task goal", "required": True}]
            },
            {
                "name": "cross_vendor_review",
                "description": "Template for cross-vendor LLM code review pipeline",
                "arguments": [{"name": "files", "description": "Files to review", "required": True}]
            }
        ]
        emit({"jsonrpc": "2.0", "id": request_id, "result": {"prompts": prompt_list}})
    elif method == "prompts/get":
        params = request.get("params") or {}
        p_name = params.get("name")
        p_args = params.get("arguments", {})
        if p_name == "dag_orchestration":
            t_goal = p_args.get("task", "Analyze and implement the feature")
            content = f"Please use orchestrate_task to decompose and execute the following task with DAG dependencies:\n{t_goal}"
        elif p_name == "cross_vendor_review":
            t_files = p_args.get("files", "")
            content = f"Please run cross-vendor multi-angle code review on the following files:\n{t_files}"
        else:
            emit(rpc_error(request_id, -32602, f"Prompt template not found: {p_name}"))
            return
        emit({"jsonrpc": "2.0", "id": request_id, "result": {
            "description": f"Prompt for {p_name}",
            "messages": [{"role": "user", "content": {"type": "text", "text": content}}]
        }})
    elif method == "notifications/progress" and request_id is None:
        # E1 progress 到 MCP：子代理 message_delta 通过此通道推给 client spinner
        # 请求无 id（通知），不需返响应；legacy 静默不报错
        return
    elif method == "tools/call":
        params = request.get("params")
        if not isinstance(params, dict) or not isinstance(params.get("arguments", {}), dict):
            emit(rpc_error(request_id, -32602, "Invalid tool arguments"))
            return
        name = params.get("name")
        arguments = params.get("arguments", {})
        if name not in _DAEMON_PATHS and name not in _LOCAL_TOOLS:
            emit(rpc_error(request_id, -32602, "Unknown tool"))
            return
        payload = call_tool(name, arguments)
        if modern and name == "spawn_agent" and _tasks_supported(request) \
                and payload.get("agent_id") is not None:
            emit({"jsonrpc": "2.0", "id": request_id, "result": _task_result(payload)})
        else:
            emit(result(request_id, payload, is_error=payload.get("status") == "error",
                        modern=modern))
    elif method in ("tasks/get", "tasks/update", "tasks/cancel"):
        if request_id is None:
            return  # 通知（无 id）不应返回响应
        if not modern or not _tasks_supported(request):
            # 2026-07-28 错误码重编号：MissingRequiredClientCapability -32003 → -32021
            emit(rpc_error(request_id, -32021, "Missing required client capability: "
                           "io.modelcontextprotocol/tasks"))
            return
        params = request.get("params") if isinstance(request.get("params"), dict) else {}
        try:
            agent_id = _agent_id_from_task(params)
        except (TypeError, ValueError):
            emit(rpc_error(request_id, -32602, "Invalid taskId"))
            return
        if method == "tasks/get":
            payload = call_tool("wait_agent", {"agent_id": agent_id, "timeout": 1})
            if payload.get("status") == "error":
                emit(_task_error(request_id, payload))
                return
            emit({"jsonrpc": "2.0", "id": request_id,
                  "result": _task_result(payload, result_type="complete")})
            return
        if method == "tasks/update":
            message = _accepted_input_text(params.get("inputResponses"))
            if not message:
                emit(rpc_error(request_id, -32602,
                               "accepted input response requires non-empty content"))
                return
            payload = call_tool("steer_agent", {"agent_id": agent_id, "message": message})
        else:
            payload = call_tool("interrupt_agent", {"agent_id": agent_id})
        if payload.get("status") == "error":
            emit(_task_error(request_id, payload))
            return
        emit({"jsonrpc": "2.0", "id": request_id, "result": {
            "resultType": "complete", "_meta": _modern_meta()}})
    elif request_id is not None:
        emit(rpc_error(request_id, -32601, f"Method not found: {method}"))


def main() -> int:
    for line in sys.stdin:
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            try:
                handle(parsed)
            except Exception as exc:
                # 任何未捕获异常 → 写 stderr 诊断，不崩溃进程
                print(f"agent-mcp: unhandled error: {exc}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
