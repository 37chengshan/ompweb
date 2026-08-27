from __future__ import annotations
import argparse
import json
import os
import re
import shlex
import sys
import threading
import time
import uuid
import hashlib
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psutil

# 单行 JSON 会话转储里 FINAL_ANSWER 摘要后的结构边界（"}] / "}, / "], ）
_JSON_BOUNDARY_RE = re.compile(r'"(?:]|}|,)')

# 脚本直接启动（python agent_mcp/daemon_main.py 或 spawn_detached 拉起）时，
# sys.path[0] 是脚本目录而非项目根，需手动补项目根才能 import agent_mcp 包
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agent_mcp import SESSION_MISMATCH_MARK
from agent_mcp.audit import compute_workspace_diff, snapshot_workspace
from agent_mcp.mailbox import MailboxManager
from agent_mcp.cli_adapters import (ResumeUnsupportedError, get_adapter,
                                    load_custom_adapters)
from agent_mcp.daemon_http import DaemonHTTPServer, EventBroadcaster, HEARTBEAT_SECONDS
from agent_mcp.db import DB
from agent_mcp.dispatch import (SlotScheduler, is_pid_running, spawn_cli_worker,
                                terminate_process_tree)
from agent_mcp.policies import PolicyEngine, PolicyEvent, PolicyResult
from agent_mcp.policies.builtin import (
    approval_policy_factory, budget_policy_factory, tool_limit_policy_factory,
)
from agent_mcp.state_machine import transition

DEFAULT_PORT = 8765
MAX_PROMPT_CHARS = 200_000
MAX_CONTEXT_CHARS = 200_000
MAX_MESSAGE_CHARS = 20_000
# wait_agent 单次阻塞上限：默认 600s（10 分钟），可用环境变量 AGENT_MCP_MAX_WAIT 调整
MAX_WAIT_SECONDS = float(os.environ.get("AGENT_MCP_MAX_WAIT", "600"))
# context_mode=compact 的截断阈值：超过此字符才 head+tail 截中间
CONTEXT_COMPACT_THRESHOLD = 8_000
# P7: CLI 首启耗时矩阵（秒）——spawn 返 min_expected_seconds 便主 agent 规划等待节奏
# 新适配器暂按 10s 保守估计（⏳ 待实测），自定义 CLI 由 load_custom_adapters 动态并入
_CLI_FIRST_START_SECONDS = {"claude": 3, "grok": 120, "omp": 5, "atomcode": 8,
                            "codex": 10, "kimi": 10, "copilot": 10,
                            "pi": 10, "zcode": 10, "cline": 10}
# 子代理"完成前自审"提醒：spawn 首次追加全文；followup 不重复全文，改追加短标记
SELF_CHECK_REMINDER = (
    "\n\n[完成前自审] 回传 FINAL_ANSWER 前必须自证目标达成："
    "核对产出是否真实可验证（测试输出/文件/自查结果）；"
    "未达成不得报完成，回传 BLOCKED 并列出已尝试项。"
)
SELF_CHECK_FOLLOWUP_TAG = "\n（续，自审同前）"

# token_budget 超额自动降档映射（claude/grok/omp/atomcode 各降一档，不连降）
MODEL_DOWNGRADE = {
    "claude-opus-4-6": "claude-sonnet-4-6",
    "claude-sonnet-4-6": "claude-haiku-4-5",
    "grok-4.5": "grok-luna",
    "grok-luna": "grok-terra",
    "deepseek-v4-pro": "deepseek-v4-flash",
}
# verify_command 失败回投的固定指令（修根因，不删测试/弱化断言）
VERIFY_FIX_INSTRUCTION = (
    "\n\n[verify failed] 上面是验证命令的失败输出。"
    "修根因而非删测试或弱化断言；保留 reproduce 路径。"
)
# 记忆银行（阶段 1）：project_memory 允许的 kind 枚举
_MEMORY_KINDS = ("decision", "lesson", "convention", "final_answer")


def _run_verify(verify_command: str, cwd: str, timeout: float = 300.0) -> tuple[bool, str]:
    """daemon 自跑 verify_command，返回 (ok, output)。超时计失败。

    A6 安全收敛：shell=False + shlex 切词执行——不再经 shell 解释 ;|&$ 等
    元字符（verify_command 来自 LLM/用户输入，此前等价于以 daemon 权限执行
    任意 shell）。无法安全切词时判失败并说明，不静默降级。
    可选白名单：AGENT_MCP_VERIFY_ALLOW_PREFIXES（逗号分隔）非空时，
    首个 token 必须命中前缀之一。"""
    try:
        cmd = shlex.split(verify_command)
    except ValueError as exc:
        return False, f"[verify command rejected: cannot safely parse ({exc})]"
    if not cmd:
        return False, "[verify command rejected: empty command]"
    allow = [p for p in os.environ.get("AGENT_MCP_VERIFY_ALLOW_PREFIXES", "").split(",") if p]
    if allow and not any(cmd[0] == p or cmd[0].startswith(p) for p in allow):
        return False, (f"[verify command rejected: '{cmd[0]}' not in "
                       f"AGENT_MCP_VERIFY_ALLOW_PREFIXES allowlist]")
    try:
        proc = subprocess.run(cmd, shell=False, cwd=cwd,
                              capture_output=True, text=True, timeout=timeout)
        output = (proc.stdout or "") + (proc.stderr or "")
        return proc.returncode == 0, output
    except subprocess.TimeoutExpired as exc:
        out = (exc.stdout.decode() if isinstance(exc.stdout, bytes) else exc.stdout or "") \
            + (exc.stderr.decode() if isinstance(exc.stderr, bytes) else exc.stderr or "")
        return False, f"[verify timed out after {timeout}s]\n{out}"
    except Exception as exc:
        return False, f"[verify run error: {exc}]"


def default_state_dir() -> Path:
    """AGENT_MCP_HOME 优先；兼容 CODEX_HOME；缺省 ~/.codex。"""
    base = (os.environ.get("AGENT_MCP_HOME")
            or os.environ.get("CODEX_HOME")
            or Path.home() / ".codex")
    return Path(base) / "agent-mcp"


DEFAULT_STATE_DIR = default_state_dir()
DEFAULT_WEB_ROOT = Path(__file__).resolve().parent.parent / "web"

_TERMINAL = ("terminated", "error", "cancelled", "incomplete")

# L2 wait 超时竞态守卫：worker 已退出但完成处理（_ingest_output/_set_status）
# 尚未落库时，wait 在 GRACE 窗口内轮询 DB 等终态，避免误报 running。
_WAIT_GRACE_SECONDS = 5.0
_WAIT_GRACE_POLL = 0.1


def _write_private(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data), encoding="utf-8")
    if os.name != "nt":
        os.chmod(path, 0o600)


def _load_or_create_token(state_dir: Path) -> str:
    """读取或生成 daemon token（0600 daemon.json；跨重启保留，MCP 端无需重读）。"""
    path = state_dir / "daemon.json"
    if path.is_file():
        try:
            token = json.loads(path.read_text(encoding="utf-8")).get("token")
            if token:
                return token
        except Exception:
            pass
    token = uuid.uuid4().hex
    _write_private(path, {"token": token})
    return token


def _read_json(path: Path | str) -> dict:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return {}


def _tail(path: Path | str, limit: int = 800) -> str:
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")[-limit:]
    except OSError:
        return ""


def _progress_lines(text: str, limit: int = 600) -> str:
    """从增量文本提取可读进度行：跳过 JSON 事件行（claude/omp stream），
    保留 atomcode 的 [thinking]/[tool→] 等文本行；截断防广播膨胀。"""
    out: list[str] = []
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("{"):
            continue
        out.append(s)
    return "\n".join(out)[-limit:]


def _merge_pending(prompt: str, pending: list[dict]) -> str:
    """followup：把挂起的 user 消息合并进新 prompt（daemon 消息队列语义）。"""
    lines = [f"<user message {i + 1}>: {m['content']}"
             for i, m in enumerate(pending) if m.get("content")]
    return prompt + ("\n\n" + "\n".join(lines) if lines else "")


def _coerce_timeout_seconds(value: Any) -> float | None:
    """daemon 边界校验 timeout_seconds：空/None 表示禁用（返回 None），
    其余必须为数值且 >0，否则同步 ValueError（不启动 worker）。"""
    if value is None or value == "":
        return None
    try:
        timeout = float(value)
    except (TypeError, ValueError):
        raise ValueError("timeout_seconds must be a positive number")
    if timeout <= 0:
        raise ValueError("timeout_seconds must be a positive number")
    return timeout


def _compact_context(context: str, mode: str) -> str:
    """按 context_mode 压缩 context，裁子代理 prompt 体积。

    full=不压；compact=超阈值 head+tail 截中间放 marker；tail=只保留末尾。
    """
    if not context or mode == "full":
        return context
    if mode == "tail":
        return context[-CONTEXT_COMPACT_THRESHOLD:]
    # compact（默认）
    if len(context) <= CONTEXT_COMPACT_THRESHOLD:
        return context
    head = context[:CONTEXT_COMPACT_THRESHOLD // 2]
    tail = context[-CONTEXT_COMPACT_THRESHOLD // 2:]
    return f"{head}\n\n[... context compacted: {len(context)} chars total ...]\n\n{tail}"


def _estimate_tokens(text: str) -> int:
    """粗估 token 数（chars/4，近似英文 token 化）。"""
    return len(text) // 4


def _spawn_cache_key(body: dict, prompt: str) -> str:
    """hash(prompt+cwd+model+target_cli+context_mode) 作缓存键。
    timeout/role_path 等不影响结果的不进键。"""
    raw = "|".join([
        body.get("target_cli") or "",
        body.get("cwd") or "",
        body.get("model") or "",
        body.get("context_mode") or "compact",
        prompt,
    ])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _extract_final_answer(out_text: str, summary_chars: int = 600) -> str:
    """从 worker stdout 提 FINAL_ANSWER: 后摘要并按 summary_chars 裁剪。

    找不到标记 → 回退 out_text 末尾截断；主 agent 拿到的是摘要不是末尾。
    """
    marker = "FINAL_ANSWER:"
    pos = out_text.rfind(marker)
    if pos >= 0:
        snippet = out_text[pos + len(marker):].strip()
        # 截到下一个 BLOCKED/NEEDS_CONTEXT 标记或文末
        for end_marker in ("\nBLOCKED:", "\nNEEDS_CONTEXT:", "\nNEEDS_DECISION:"):
            epos = snippet.find(end_marker)
            if epos >= 0:
                snippet = snippet[:epos].strip()
                break
        # 单行场景（omp/atomcode 的 out 是单行巨型 JSON 会话转储）：FINAL_ANSWER 位于
        # "text":"FINAL_ANSWER: ..." 里，摘要外是 JSON 结构边界（"}] 或 "}, 或 "]，）——
        # 截掉 JSON 尾巴；多行文本场景摘要里正常含引号，不受影响。
        if "\n" not in snippet:
            json_boundary = _JSON_BOUNDARY_RE.search(snippet)
            if json_boundary:
                snippet = snippet[:json_boundary.start()].strip()
        return snippet[:summary_chars]
    return out_text[-summary_chars:]


def _final_summary(path: Path | str, summary_chars: int = 600) -> str:
    """从 worker out 文件提取终态摘要：优先 FINAL_ANSWER: 标记，找不到回退尾部截断。

    omp 等 CLI 的 out 是单行巨型 JSON 会话转储——FINAL_ANSWER 位于文件中部、文件末尾
    是 JSON 闭合（isTerminal），直接 _tail 会抓到工具结果碎片而非最终回答；因此只采样
    文件尾部 256KB（标记总在最终 assistant 消息内，必落在此窗口），在其内 rfind 标记。
    """
    path = Path(path)
    tail_bytes = 256 * 1024
    try:
        size = path.stat().st_size
        with path.open("rb") as fh:
            if size > tail_bytes:
                fh.seek(size - tail_bytes)
            raw = fh.read()
    except OSError:
        return ""
    return _extract_final_answer(raw.decode("utf-8", errors="replace"), summary_chars)


# 角色预设 frontmatter 解析缓存：path -> frontmatter dict
_ROLE_FRONTmatter_CACHE: dict[str, dict] = {}


def _load_role_frontmatter(role_path: str | None) -> dict:
    """解析角色预设 .md 的 YAML frontmatter（name/default_cli/default_model/
    default_permission/default_summary_chars/default_context_mode/critical_path）。

    非角色预设文件（无 frontmatter 或解析失败）返回 {}，spawn 不强制。
    frontmatter 的 default_* 仅作默认值，spawn 显式参数永远优先。
    """
    if not role_path:
        return {}
    path = Path(role_path)
    if not path.is_file():
        return {}
    cached = _ROLE_FRONTmatter_CACHE.get(str(path))
    if cached is not None:
        return cached
    text = path.read_text(encoding="utf-8", errors="replace")
    fm: dict = {}
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end > 0:
            for line in text[3:end].splitlines():
                if ":" not in line:
                    continue
                k, _, v = line.partition(":")
                k = k.strip()
                v = v.strip()
                if v.lower() in ("true", "false"):
                    fm[k] = v.lower() == "true"
                elif v.isdigit():
                    fm[k] = int(v)
                elif v:
                    fm[k] = v
    _ROLE_FRONTmatter_CACHE[str(path)] = fm
    return fm


def _apply_role_defaults(body: dict) -> dict:
    """spawn body 未显式传的字段从 role frontmatter 取默认值。

    critical_path=true 自动升 context_mode=full（关键路径不压缩丢信息）。
    """
    role_path = body.get("role_path")
    fm = _load_role_frontmatter(role_path)
    if not fm:
        return body
    for key in ("target_cli", "model", "permission_mode", "summary_chars",
                "context_mode"):
        fm_key = f"default_{key}" if key not in ("target_cli",) else "default_cli"
        if body.get(key) is None and fm.get(fm_key) is not None:
            body[key] = fm[fm_key]
    if fm.get("critical_path") and body.get("context_mode") is None:
        body["context_mode"] = "full"
    return body


class Dispatcher:
    """CLI 任务派发执行器：spawn/send_message/followup/wait/interrupt/
    list_agents/activity/usage 八操作 + 完成检测监控线程。

    spawn/followup 复用 dispatch.spawn_cli_worker（不重写 spawn 逻辑）；
    SlotScheduler 按 agent_id FIFO 限流（同 id 并发 followup 自动串联）；
    interrupt 用 terminate_process_tree；worker 完成由 state 文件轮询检测。
    """
    def __init__(self, *, db: Any, broadcaster: EventBroadcaster, state_dir: Path | str,
                 max_concurrent: int = 4, spawn_fn: Any = None,
                 monitor_interval: float = 1.0):
        self.db = db
        self.broadcaster = broadcaster
        self.state_dir = Path(state_dir)
        self._scheduler = SlotScheduler(max_concurrent=max_concurrent)
        self._spawn_fn = spawn_fn or spawn_cli_worker
        self._monitor_interval = monitor_interval
        self._workers: dict[int, dict[str, Any]] = {}   # agent_id -> spawn info
        self._pending: dict[int, tuple[str, str, str, dict]] = {}  # 排队中的 spawn 参数
        self._EVENTS_CAP = 512  # A5: _events 容量上限（超限淘汰已 set 的最旧条目）
        self._offsets: dict[int, dict[str, int]] = {}  # agent_id -> {path: 已 tail 字节数}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        # F1: 每个 agent_id 配一个 threading.Event；worker 终态时 set，wait 阻塞不轮询
        self._events: dict[int, threading.Event] = {}
        # F6: worker watcher 线程注册（proc.wait 阻塞等退出，不轮询）
        self._watchers: dict[int, threading.Thread] = {}
        # F4: 低频心跳线程（1s/touch_activity 更 updated_at）作存活证据源
        self._hb_stop = threading.Event()
        self._hb_thread: threading.Thread | None = None
        # v0.3 策略引擎：daemon 级 enforcement（spawn/usage 数据源都在本进程）
        self.policy_engine = PolicyEngine(state_path=self.state_dir / "policies.json")
        self.policy_engine.register("budget_policy", budget_policy_factory(
            limit_usd=float(os.environ.get("AGENT_MCP_BUDGET_USD", "10.0"))))
        self.policy_engine.register("approval_policy", approval_policy_factory(
            allow_prefixes=[p for p in
                            os.environ.get("AGENT_MCP_ALLOW_PREFIXES", "").split(",") if p]))
        self.policy_engine.register("tool_limit_policy", tool_limit_policy_factory(
            max_subtasks=int(os.environ.get("AGENT_MCP_MAX_SUBTASKS", "8")),
            max_parallel=int(os.environ.get("AGENT_MCP_MAX_PARALLEL", "4"))))

    # ---- 生命周期 ----

    def _take_pending(self, agent_id: int) -> tuple | None:
        """A5: 弹出内存排队参数并清掉 DB 持久化副本（开始运行即无需再恢复）。

        所有"从 _pending 取参开跑"的路径必须经此方法，保证内存与落库副本一致。"""
        with self._lock:
            params = self._pending.pop(agent_id, None)
        try:
            self.db.set_pending_params(agent_id, None)
        except Exception as exc:
            print(f"[dispatcher] clear pending failed for agent {agent_id}: {exc}",
                  file=sys.stderr)
        return params

    def _cap_events_locked(self) -> None:
        """A5: _events 容量回收——超上限时淘汰已 set（终态已信号）的最旧条目。

        长驻 daemon 此前永不回收，属内存泄漏。必须在持有 self._lock 时调用。
        迟到的 wait 者不受影响：wait_agent 有 GRACE/超时兜底，会回落 DB 终态查询。"""
        overflow = len(self._events) - self._EVENTS_CAP
        if overflow <= 0:
            return
        for k in [k for k, v in self._events.items() if v.is_set()][:overflow]:
            self._events.pop(k, None)

    def start(self) -> None:
        # D2: 启动前扫 DB 所有 running 状态的 agent，worker_pid 不存活则标 incomplete
        self._recover_orphans()
        # A5: 恢复重启前排队中的任务（pending_params 落库副本）
        self._rehydrate_queue()
        if self._thread is None:
            self._thread = threading.Thread(target=self._monitor, daemon=True,
                                            name="dispatcher-monitor")
            self._thread.start()
        # F4: 启低频心跳线程（1s/touch_activity 更 updated_at）作存活证据源
        if self._hb_thread is None:
            self._hb_stop.clear()
            self._hb_thread = threading.Thread(target=self._heartbeat_loop,
                                               daemon=True,
                                               name="dispatcher-heartbeat")
            self._hb_thread.start()

    def _recover_orphans(self) -> None:
        """D2+A5: 扫 DB 所有 running 状态的 agent，按 worker_pid 存活与否分流。

        - pid 不存活（daemon 崩溃后孤儿）→ 标 incomplete + 孤儿事件（原 D2 行为）；
        - pid 仍存活 → 旧 daemon 的 watcher 已丢失，据落库 worker_info 重建 info
          并重新挂 psutil watcher「认领」，退出后照常走 _check_worker。
          认领的 run 无 initial_snapshot/body：审计结算与 verify 回投自动跳过，
          属诚实降级而非静默丢失。
        """
        try:
            agents = self.db.agents_by_session(None)
        except Exception:
            return
        for agent in agents:
            if agent.get("status") != "running":
                continue
            pid = agent.get("pid")
            agent_id = agent["id"]
            if not is_pid_running(pid):
                self._set_status(agent_id, "incomplete", stop_reason="orphaned")
                self._broadcast("agent.orphaned", {
                    "agent_id": agent_id, "worker_pid": pid,
                    "message": "daemon restarted; worker_pid no longer alive"
                }, agent_id)
                continue
            # A5: 认领仍存活的 worker
            info: dict[str, Any] = {"adopted": True, "cwd": agent.get("cwd") or ""}
            try:
                raw = agent.get("worker_info")
                if raw:
                    info.update(json.loads(raw))
            except (TypeError, ValueError):
                pass  # worker_info 损坏按最小 info 认领；state_path 缺失时完成检测走孤儿分支
            with self._lock:
                self._workers[agent_id] = info
                t = threading.Thread(target=self._worker_watcher, args=(agent_id,),
                                     daemon=True, name=f"worker-watch-{agent_id}")
                self._watchers[agent_id] = t
            t.start()
            self._broadcast("agent.running", {
                "agent_id": agent_id, "pid": pid, "adopted": True,
                "message": "daemon restarted; surviving worker re-adopted"
            }, agent_id)

    def _rehydrate_queue(self) -> None:
        """A5: 恢复上次 daemon 退出时排队中的任务（agents.pending_params 落库副本）。

        有空槽则立即开跑；无空槽则回内存 _pending + SlotScheduler 排队，
        由既有补位机制（_release_and_promote → _start_queued）在槽位释放时接续。
        落库参数损坏的记录标失败，避免永久滞留 queued。"""
        try:
            agents = self.db.agents_by_session(None)
        except Exception:
            return
        for agent in agents:
            if agent.get("status") != "queued" or not agent.get("pending_params"):
                continue
            agent_id = agent["id"]
            try:
                loaded = json.loads(agent["pending_params"])
                if not (isinstance(loaded, list) and len(loaded) == 4):
                    raise ValueError("bad shape")
                params: tuple = tuple(loaded)
            except (TypeError, ValueError):
                self._fail(agent_id, stop_reason="queued_params_corrupted",
                           message="persisted pending_params unparseable after restart",
                           error_type="state_corrupted",
                           hint="respawn the task with spawn_agent")
                continue
            with self._lock:
                self._pending[agent_id] = params
                self._events.setdefault(agent_id, threading.Event())
                self._cap_events_locked()
            body = params[3] if isinstance(params[3], dict) else {}
            is_write = (body.get("permission_mode") or "plan") in ("acceptEdits", "fullAccess")
            if self._scheduler.acquire(str(agent_id), is_write=is_write):
                self._take_pending(agent_id)
                self._run_worker(agent_id, *params)

    def stop(self) -> None:
        self._stop.set()
        self._hb_stop.set()
        if self._hb_thread is not None:
            self._hb_thread.join(timeout=2)
            self._hb_thread = None
        # A5：停机前把策略引擎脏状态刷盘（热路径已去同步写，靠此兜底）
        try:
            self.policy_engine.save_if_dirty()
        except Exception as exc:
            print(f"[dispatcher] policy save on stop failed: {exc}", file=sys.stderr)
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None

    def _heartbeat_loop(self) -> None:
        """F4: 低频心跳线程——1s/touch_activity 更 updated_at，作存活证据源；
        空闲 daemon CPU≈0（仅 sleep+轻量 UPDATE）。A5：每 30s 顺带把策略引擎
        的脏状态落盘（save_if_dirty），替代原先 usage 结算热路径的同步写。"""
        tick = 0
        while not self._hb_stop.wait(1.0):
            tick += 1
            with self._lock:
                ids = list(self._workers)
            for agent_id in ids:
                try:
                    self.db.touch_activity(agent_id)
                except Exception:
                    pass  # 心跳失败不致命，下一轮重试
            if tick % 30 == 0:
                try:
                    self.policy_engine.save_if_dirty()
                except Exception as exc:
                    print(f"[dispatcher] policy save failed: {exc}", file=sys.stderr)

    def _monitor(self) -> None:
        # F6: worker 终态由 _worker_watcher（proc.wait 阜塞）驱动，不再轮询 _check_worker；
        # monitor 仅做运行中增量 tail 进度广播（仍需周期扫新字节）。空闲时 CPU≈0。
        # 孤儿扫兜底：watcher 葡一次就退后，若 state 被外部改到 running 且 pid 已死，
        # watcher 已不再触发 _check_worker——monitor 周期补扫孤儿态防漏。
        while not self._stop.wait(self._monitor_interval):
            with self._lock:
                ids = list(self._workers)
            for agent_id in ids:
                try:
                    self._tail_progress(agent_id)
                    # 终态兜底：watcher 葡一次就退后，若 state 被外部改到 finished/running+pid死，
                    # watcher 已不再触发 _check_worker——monitor 周期补扫防漏。
                    # 幂等守卫：_check_worker 处理终态后会 pop _workers，这里取 info 后再判一次是否还在，
                    # 避免对已终态 agent 重复触发二次补位。
                    with self._lock:
                        info = self._workers.get(agent_id)
                        if info is None:
                            continue
                        st = _read_json(info["state_path"])
                    if st.get("status") == "finished":
                        self._check_worker(agent_id)
                    elif st.get("status") == "running" and not is_pid_running(info.get("worker_pid")):
                        self._check_worker(agent_id)
                except Exception as exc:
                    print(f"[dispatcher] monitor error for agent {agent_id}: {exc}",
                          file=sys.stderr)

    # ---- 八操作 ----

    def spawn(self, body: dict) -> dict:
        body = _apply_role_defaults(body)
        target_cli = body.get("target_cli")
        prompt = body.get("prompt")
        cwd = body.get("cwd")
        if not target_cli or not prompt or not cwd:
            raise ValueError("target_cli, prompt and cwd are required")
        # v0.3 策略 enforcement：spawn 入口前（编排子任务/HTTP 直连同源拦截）
        decision = self.policy_engine.evaluate(PolicyEvent(
            "pre_spawn", data={"cli": target_cli, "prompt": prompt,
                               "permission_mode": body.get("permission_mode") or "plan",
                               "estimated_cost": 0.0}))
        if decision.result != PolicyResult.ALLOW.value:
            self.policy_engine.save()
            return {"status": "denied", "policy": decision.name,
                    "result": decision.result, "reason": decision.reason}
        self.policy_engine.state["spawns"] = int(
            self.policy_engine.state.get("spawns", 0)) + 1
        self.policy_engine.save()
        timeout_seconds = _coerce_timeout_seconds(body.get("timeout_seconds"))
        body = {**body, "timeout_seconds": timeout_seconds}
        context_mode = body.get("context_mode") or "compact"
        context = _compact_context(body.get("context") or "", context_mode)
        if len(body.get("context") or "") > MAX_CONTEXT_CHARS:
            raise ValueError(f"context exceeds {MAX_CONTEXT_CHARS} chars")
        if context:
            prompt = f"{context}\n\n{prompt}"
        prompt += SELF_CHECK_REMINDER
        if len(prompt) > MAX_PROMPT_CHARS:
            raise ValueError(f"prompt exceeds {MAX_PROMPT_CHARS} chars")
        # spawn 结果缓存：读密集任务相同请求在 TTL 内直接返缓存，0 token
        cache_ttl = float(body.get("cache_ttl") or 0)
        if cache_ttl > 0:
            cache_key = _spawn_cache_key(body, prompt)
            hit = self.db.spawn_cache_get(cache_key)
            if hit is not None:
                res = dict(hit["result"])
                res["cached"] = True
                res["prompt_chars"] = len(prompt)
                res["estimated_tokens"] = _estimate_tokens(prompt)
                res["min_expected_seconds"] = _CLI_FIRST_START_SECONDS.get(target_cli, 10)
                return res
        agent_id = self.db.insert_agent(
            parent_id=body.get("parent_agent_id"),
            session_id=body.get("session_id") or "default",
            task_name=body.get("task_name") or "",
            cli=target_cli, model=body.get("model"), cwd=cwd,
            permission_mode=body.get("permission_mode") or "plan",
            command_summary=None)
        # F1: 给此 agent_id 建一个 threading.Event，终态时 set 唤醒 wait
        with self._lock:
            self._events[agent_id] = threading.Event()
        self._broadcast("agent.spawned", {"agent_id": agent_id}, agent_id)
        self._broadcast("agent.user_turn", {"text": prompt, "kind": "spawn"}, agent_id)
        # 先写 pending 再 acquire：避免补位时 pending 未就绪导致任务永久滞留
        params = (target_cli, prompt, cwd, body)
        with self._lock:
            self._pending[agent_id] = params
            self._cap_events_locked()
        # A5: 排队参数落库，daemon 重启后可恢复派发
        try:
            self.db.set_pending_params(agent_id, json.dumps(params, ensure_ascii=False))
        except Exception as exc:
            print(f"[dispatcher] persist pending failed for agent {agent_id}: {exc}",
                  file=sys.stderr)
        is_write = (body.get("permission_mode") or "plan") in ("acceptEdits", "fullAccess")
        if self._scheduler.acquire(str(agent_id), is_write=is_write):
            self._take_pending(agent_id)
            res = self._run_worker(agent_id, *params)
        else:
            res = self._agent_result(agent_id, status="queued", pid=None)
        res["prompt_chars"] = len(prompt)
        res["estimated_tokens"] = _estimate_tokens(prompt)
        res["min_expected_seconds"] = _CLI_FIRST_START_SECONDS.get(target_cli, 10)
        # 完成态结果存缓存（terminated 才存，error/incomplete 不存）
        if cache_ttl > 0 and res.get("status") == "terminated":
            try:
                self.db.spawn_cache_put(cache_key, agent_id, res, cache_ttl)
            except Exception as exc:
                print(f"[dispatcher] spawn cache put failed for agent {agent_id}: {exc}",
                      file=sys.stderr)
        return res

    def send_message(self, body: dict) -> dict:
        agent_id = self._require_id(body)
        message = body.get("message")
        if not message:
            raise ValueError("message is required")
        if len(message) > MAX_MESSAGE_CHARS:
            raise ValueError(f"message exceeds {MAX_MESSAGE_CHARS} chars")
        agent = self.db.get_agent(agent_id)
        if agent is None:
            raise ValueError(f"agent {agent_id} not found")
        self._require_session(body, agent)
        self.db.insert_message(agent_id=agent_id, role="user", content=message)
        status = "undelivered" if agent["status"] in _TERMINAL else "delivered"
        return {"agent_id": agent_id, "status": status}

    def followup(self, body: dict) -> dict:
        """唯一触发新 turn 的入口：合并挂起消息进 prompt 后重新 spawn。
        运行中的 agent 走槽位队列，当前 run 结束后自动串联。"""
        agent_id = self._require_id(body)
        prompt = body.get("prompt")
        if not prompt:
            raise ValueError("prompt is required")
        if len(prompt) > MAX_PROMPT_CHARS:
            raise ValueError(f"prompt exceeds {MAX_PROMPT_CHARS} chars")
        timeout_seconds = _coerce_timeout_seconds(body.get("timeout_seconds"))
        body = {**body, "timeout_seconds": timeout_seconds}
        agent = self.db.get_agent(agent_id)
        if agent is None:
            raise ValueError(f"agent {agent_id} not found")
        self._require_session(body, agent)
        if body.get("interrupt") and agent["status"] == "running":
            self.interrupt({"agent_id": agent_id, "session_id": agent["session_id"]})
            agent = self.db.get_agent(agent_id)
        pending_msgs = self.db.messages_for(agent_id)
        merged = _merge_pending(prompt, pending_msgs)
        merged += SELF_CHECK_FOLLOWUP_TAG  # followup 不重复全文，追加短标记
        if len(merged) > MAX_PROMPT_CHARS:
            # 合并挂起消息后超限：在写 pending/启动前拒绝
            raise ValueError(f"prompt exceeds {MAX_PROMPT_CHARS} chars")
        self._broadcast("agent.user_turn", {"text": prompt,
                                             "kind": "steer" if body.get("interrupt") else "followup"},
                        agent_id)
        resume = body.get("resume") or agent.get("cli_session_id")
        body = {
            **body,
            "model": body.get("model") or agent.get("model"),
            "permission_mode": (
                body.get("permission_mode")
                or agent.get("permission_mode")
                or "plan"
            ),
            "resume": resume,
        }
        params = (agent["cli"], merged, agent["cwd"], body)
        # B3: followup 允许显式 target_cli 跨底座续跑（用户/主 Agent 指定，
        # 系统不擅自更换）；切换即更新 DB 归属，保证画像与监控口径一致
        override_cli = str(body.get("target_cli") or "").strip()
        if override_cli and override_cli != agent["cli"]:
            get_adapter(override_cli)  # 未注册适配器 → ValueError 结构化报错
            params = (override_cli, merged, agent["cwd"], body)
            self.db.set_cli(agent_id, override_cli)
            self._broadcast("agent.user_turn", {
                "text": f"target_cli switched to {override_cli} (user-declared)",
                "kind": "harness_switch"}, agent_id)
        # L3: expected_end_seconds——按当前 run 的 timeout_seconds 推估结束时间戳
        expected_end = (time.time() + timeout_seconds) if timeout_seconds else None
        with self._lock:
            self._pending[agent_id] = params
            self._cap_events_locked()
        # A5: followup 排队参数同样落库
        try:
            self.db.set_pending_params(agent_id, json.dumps(params, ensure_ascii=False))
        except Exception as exc:
            print(f"[dispatcher] persist pending failed for agent {agent_id}: {exc}",
                  file=sys.stderr)
        # 终态 agent 续跑：先释放旧槽位（watcher 退出时可能未清），否则 acquire 返 False 误 queued
        self._scheduler.remove(str(agent_id))
        if self._scheduler.acquire(str(agent_id)):
            self._take_pending(agent_id)
            res = self._run_worker(agent_id, *params)
            res["merged_messages"] = len(pending_msgs)
            res["resumed_session_id"] = resume
            if expected_end is not None:
                res["expected_end_seconds"] = expected_end
            return res
        return self._agent_result(agent_id, status="queued", pid=None,
                                  merged_messages=len(pending_msgs),
                                  resumed_session_id=resume,
                                  expected_end_seconds=expected_end)

    def steer(self, body: dict) -> dict:
        """中断当前 run 并在同一节点立即开始下一 turn；支持的 CLI 自动 resume。"""
        agent_id = self._require_id(body)
        message = body.get("message")
        if not message:
            raise ValueError("message is required")
        if len(message) > MAX_MESSAGE_CHARS:
            raise ValueError(f"message exceeds {MAX_MESSAGE_CHARS} chars")
        agent = self.db.get_agent(agent_id)
        if agent is None:
            raise ValueError(f"agent {agent_id} not found")
        self._require_session(body, agent)
        interrupted = agent["status"] == "running"
        result = self.followup({"agent_id": agent_id, "prompt": message,
                                "interrupt": interrupted,
                                "session_id": agent["session_id"]})
        result["interrupted"] = interrupted
        return result

    def wait(self, body: dict) -> dict:
        """短阻塞等待（默认 25s，上限 MAX_WAIT_SECONDS 可自定义）；完成后返回摘要 + 结构化结果，超时给存活证据。

        F1: 事件驱动——阻塞在 threading.Event.wait(timeout) 不轮询；终态时 _set_status set 唤醒。
        超时兜底仍走一次原轮询路径查 state 防漏（state 文件先于 DB 写入的窗口）。
        L2 竞态守卫：worker 进程已退出（_workers 已 pop）但 _check_worker 尚未完成
        （_ingest_output/_set_status 进行中，watcher 线程仍在）时，短窗内 DB 仍非终态——
        此时返回 running 会让客户端误判"未完成"。超时路径若发现 watcher 仍在，则
        在 GRACE 窗口内轮询 DB 等终态落库，之后才给 liveness 超时返回。"""
        agent_id = self._require_id(body)
        timeout = min(max(float(body.get("timeout") or 25), 0.1), MAX_WAIT_SECONDS)
        deadline = time.monotonic() + timeout
        summary_chars = int(body.get("summary_chars") or 600)
        return_ref = bool(body.get("return_ref"))
        with self._lock:
            ev = self._events.setdefault(agent_id, threading.Event())
        # fast-path：进入阻塞前先查一次 DB 终态——已终态 agent（无 worker/event 唤醒）
        # 直接返回，避免 wait_agent 脚本对已完成任务白等一个 interval
        agent = self.db.get_agent(agent_id)
        if agent is None:
            raise ValueError(f"agent {agent_id} not found")
        self._require_session(body, agent)
        if agent["status"] in _TERMINAL or agent["status"] == "needs_advisor":
            return self._wait_result(agent, "", summary_chars=summary_chars,
                                     return_ref=return_ref)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                # 超时兜底：走一次原轮询路径查 state 防漏（state 先于 DB 写入的窗口）
                with self._lock:
                    info = self._workers.get(agent_id)
                    watcher = self._watchers.get(agent_id)
                if info and _read_json(info["state_path"]).get("status") == "finished":
                    self._check_worker(agent_id)
                agent = self.db.get_agent(agent_id)
                if agent is None:
                    raise ValueError(f"agent {agent_id} not found")
                self._require_session(body, agent)
                if agent["status"] in _TERMINAL:
                    return self._wait_result(agent, "", summary_chars=summary_chars,
                                             return_ref=return_ref)
                # L2 竞态守卫：_workers 已 pop 但 watcher 仍在（_check_worker 完成处理中）——
                # 短窗内 DB 尚未落终态。轮询 DB 等终态，避免误报 running。
                if watcher is not None and info is None:
                    grace_deadline = time.monotonic() + _WAIT_GRACE_SECONDS
                    while time.monotonic() < grace_deadline:
                        agent = self.db.get_agent(agent_id)
                        if agent is not None and agent["status"] in _TERMINAL:
                            return self._wait_result(agent, "",
                                                     summary_chars=summary_chars,
                                                     return_ref=return_ref)
                        with self._lock:
                            if self._watchers.get(agent_id) is None:
                                break  # watcher 已退出：完成处理收尾，DB 立即可见
                        time.sleep(_WAIT_GRACE_POLL)
                agent = self.db.get_agent(agent_id)
                if agent is not None and agent["status"] in _TERMINAL:
                    return self._wait_result(agent, "", summary_chars=summary_chars,
                                             return_ref=return_ref)
                # L2: 超时返 liveness 结构化字段（worker_pid_alive/log_growing/healthy）
                liveness = self._liveness_struct(agent_id, info)
                return self._agent_result(
                    agent_id, status=agent["status"],
                    hint="still running; call wait_agent again (timeout 25s) "
                         "to keep waiting; do not poll list_agents/activity",
                    liveness=liveness)
            # F1: 阻塞在 Event 上不轮询；终态时 _set_status set 唤醒
            ev.wait(timeout=remaining)
            ev.clear()  # 清后重查，防 spurious wakeup；若有新终态会再 set
            # 唤醒后查一次 state（state 先于 DB）+ DB 终态
            with self._lock:
                info = self._workers.get(agent_id)
            if info and _read_json(info["state_path"]).get("status") == "finished":
                summary = _final_summary(info["out_path"], summary_chars)
                self._check_worker(agent_id)
                agent = self.db.get_agent(agent_id)
                if agent is None:
                    raise ValueError(f"agent {agent_id} not found")
                self._require_session(body, agent)
                return self._wait_result(agent, summary, summary_chars=summary_chars,
                                         return_ref=return_ref)
            agent = self.db.get_agent(agent_id)
            if agent is None:
                raise ValueError(f"agent {agent_id} not found")
            self._require_session(body, agent)
            if agent["status"] in _TERMINAL or agent["status"] == "needs_advisor":
                return self._wait_result(agent, "", summary_chars=summary_chars,
                                         return_ref=return_ref)
            # 非终态唤醒（spurious/中间态）→ 继续阻塞至 deadline

    def interrupt(self, body: dict) -> dict:
        agent_id = self._require_id(body)
        agent = self.db.get_agent(agent_id)
        if agent is None:
            raise ValueError(f"agent {agent_id} not found")
        self._require_session(body, agent)
        if agent["status"] in _TERMINAL:
            self._scheduler.remove(str(agent_id))
            return self._agent_result(agent_id, status=agent["status"],
                                      stop_reason=agent["stop_reason"],
                                      usage_incomplete=False)
        with self._lock:
            info = self._workers.pop(agent_id, None)
            cancelled_pending = self._pending.pop(agent_id, None)
        if cancelled_pending is not None:
            # A5：取消排队任务时同步清掉落库副本
            try:
                self.db.set_pending_params(agent_id, None)
            except Exception as exc:
                print(f"[dispatcher] clear pending failed for agent {agent_id}: {exc}",
                      file=sys.stderr)
        if info and info.get("worker_pid"):
            terminate_process_tree(info["worker_pid"])
            self._release_and_promote(str(agent_id))
        else:
            self._scheduler.remove(str(agent_id))
        self._set_status(agent_id, "cancelled", stop_reason="interrupted")
        self._broadcast("agent.cancelled", {"agent_id": agent_id,
                                            "stop_reason": "interrupted"}, agent_id)
        return self._agent_result(agent_id, status="cancelled",
                                  stop_reason="interrupted", usage_incomplete=True)

    def list_agents(self, body: dict) -> dict:
        # F3: agents_by_session 已 LEFT JOIN 返 last_message，无需逐行 messages_for
        agents = self.db.agents_by_session(body.get("session_id"))
        # P3: fields 裁剪——默认只返轻量字段，fields=all 返全量
        if body.get("fields") != "all":
            _KEEP = {"id", "task_name", "status", "stop_reason"}
            agents = [{k: a[k] for k in _KEEP if k in a} for a in agents]
        return {"agents": agents}

    def activity(self, body: dict) -> dict:
        since_seq = int(body.get("since_seq") or 0)
        agent_id = body.get("agent_id")
        session_id = body.get("session_id")
        if agent_id is not None:
            agent = self.db.get_agent(int(agent_id))
            if agent is None:
                raise ValueError(f"agent {agent_id} not found")
            self._require_session(body, agent)
            session_id = agent["session_id"]
        # P4: 默认压缩已消费 tool_use/result payload，include=verbose 才返全量
        compress = body.get("include") != "verbose"
        events = self.db.events_since(
            since_seq, session_id=session_id,
            compress_consumed=compress, keep_recent=5)
        if agent_id is not None:
            events = [e for e in events if e.get("agent_id") == int(agent_id)]
        return {"events": events,
                "next_seq": events[-1]["seq"] if events else since_seq}

    def usage(self, body: dict) -> dict:
        if body.get("agent_id") is not None:
            agent = self.db.get_agent(int(body["agent_id"]))
            if agent is None:
                raise ValueError(f"agent {body['agent_id']} not found")
            self._require_session(body, agent)
            totals = self.db.usage_total(int(body["agent_id"]))
        else:
            totals: dict[str, Any] = {"input_tokens": 0, "output_tokens": 0,
                                      "cache_creation": 0, "cache_read": 0,
                                      "cost_usd": 0.0}
            for a in self.db.agents_by_session(body.get("session_id")):
                for k, v in self.db.usage_total(a["id"]).items():
                    totals[k] = totals.get(k, 0) + v
        totals["estimated"] = True
        return totals

    # ---- 记忆银行（阶段 1）：memory_store / memory_recall + FINAL_ANSWER 自动沉淀 ----

    def memory_store(self, body: dict) -> dict:
        """写一条记忆。content 必填；kind 默认 lesson（decision/lesson/convention/final_answer）；
        session_id 缺省 'default'；key/tags/source 可选。"""
        content = body.get("content")
        if not content or not str(content).strip():
            raise ValueError("content is required")
        kind = body.get("kind") or "lesson"
        if kind not in _MEMORY_KINDS:
            raise ValueError(f"kind must be one of {_MEMORY_KINDS}")
        mid = self.db.insert_memory(
            session_id=body.get("session_id") or "default", kind=kind,
            key=body.get("key"), content=str(content).strip(),
            tags=body.get("tags"), source=body.get("source"))
        return {"id": mid, "status": "stored"}

    def memory_recall(self, body: dict) -> dict:
        """检索记忆：query 关键词 LIKE 命中 content/key/tags，可按 kind 过滤，
        limit 截断（默认 5，上限 20），按时间倒序，仅同 session 可见。"""
        try:
            limit = min(max(int(body.get("limit") or 5), 1), 20)
        except (TypeError, ValueError):
            limit = 5
        memories = self.db.recall_memories(
            body.get("session_id") or "default",
            query=body.get("query"), kind=body.get("kind"), limit=limit)
        return {"memories": memories}

    # ---- P2P 信箱与共识投票 ----

    def _require_mailbox_member(self, body: dict) -> int:
        """A6: mailbox/consensus 身份校验——from_agent_id 必须是真实存在的 agent；
        调用方提供 session_id 时还须同会话，防跨会话/伪造身份投票与广播。
        会话不符的报错文案复用 SESSION_MISMATCH_MARK 短语供 MCP 层分流。"""
        raw = body.get("from_agent_id")
        try:
            agent_id = int(raw)
        except (TypeError, ValueError):
            raise ValueError("from_agent_id 必须是整数 agent id")
        agent = self.db.get_agent(agent_id)
        if agent is None:
            raise ValueError(f"from_agent_id {agent_id} 不存在（拒绝伪造身份）")
        session_id = body.get("session_id")
        if session_id and agent.get("session_id") != session_id:
            raise ValueError(f"agent {agent_id} does not belong to session {session_id}")
        return agent_id

    def mailbox_send(self, body: dict) -> dict:
        mgr = MailboxManager(self.db)
        team = str(body.get("team") or "default")
        from_agent_id = self._require_mailbox_member(body)
        to_agent_id = body.get("to_agent_id")
        to_id = int(to_agent_id) if to_agent_id is not None else None
        msg_type = str(body.get("msg_type") or "text")
        payload = body.get("payload")
        message = str(body.get("message") or "")
        mid = mgr.send(team_id=team, from_agent_id=from_agent_id, to_agent_id=to_id,
                       msg_type=msg_type, payload=payload, message=message)
        return {"id": mid, "status": "sent"}

    def mailbox_fetch(self, body: dict) -> dict:
        mgr = MailboxManager(self.db)
        team = str(body.get("team") or "default")
        agent_id = body.get("agent_id")
        if agent_id is None:
            raise ValueError("agent_id 必填（收件箱归属的 agent）")
        aid = int(agent_id)
        unread_only = bool(body.get("unread_only", True))
        limit = min(max(int(body.get("limit") or 20), 1), 100)
        msgs = mgr.fetch_inbox(team_id=team, agent_id=aid, unread_only=unread_only, limit=limit)
        return {"messages": msgs}

    def consensus_vote(self, body: dict) -> dict:
        mgr = MailboxManager(self.db)
        team = str(body.get("team") or "default")
        action = body.get("action") or "vote"  # "propose" | "vote" | "tally"
        if action == "propose":
            from_agent_id = self._require_mailbox_member(body)
            proposal = str(body.get("proposal") or "")
            mid = mgr.broadcast(team_id=team, from_agent_id=from_agent_id, message=proposal,
                                msg_type="proposal")
            return {"id": mid, "status": "proposed"}
        elif action == "vote":
            from_agent_id = self._require_mailbox_member(body)
            vote_val = bool(body.get("vote", True))
            reason = str(body.get("reason") or "")
            topic = body.get("topic")
            mid = mgr.send_vote(team_id=team, from_agent_id=from_agent_id,
                                vote=vote_val, topic=topic, reason=reason)
            return {"id": mid, "status": "voted"}
        elif action == "tally":
            res = mgr.tally_votes(team_id=team, topic=body.get("topic"))
            return {"tally": res}
        else:
            raise ValueError(f"Unknown action {action}")

    # ---- v0.3 策略管理（daemon 级：唯一数据源，enforcement 与面板同源） ----

    def policy_list(self, body: dict) -> dict:
        return {"policies": self.policy_engine.list_policies(),
                "state": {k: v for k, v in self.policy_engine.snapshot().items()
                          if k != "log"}}

    def policy_state(self, body: dict) -> dict:
        snap = self.policy_engine.snapshot()
        snap["policy_configs"] = {
            "budget_limit_usd": float(os.environ.get("AGENT_MCP_BUDGET_USD", "10.0")),
            "max_subtasks": int(os.environ.get("AGENT_MCP_MAX_SUBTASKS", "8")),
            "max_parallel": int(os.environ.get("AGENT_MCP_MAX_PARALLEL", "4")),
            "allow_prefixes": [p for p in
                               os.environ.get("AGENT_MCP_ALLOW_PREFIXES", "").split(",") if p],
        }
        return snap

    def policy_add(self, body: dict) -> dict:
        """收紧-only 策略配置：新 limit 必须 ≤ 当前值，禁止自我削弱（H3）。"""
        name = str(body.get("name") or "")
        params = body.get("params") or {}
        if not isinstance(params, dict):
            raise ValueError("params 必须是对象")
        current = self.policy_engine.snapshot()
        if name == "budget_policy":
            new_limit = float(params.get("limit_usd", 10.0))
            old_limit = float(os.environ.get("AGENT_MCP_BUDGET_USD", "10.0"))
            if new_limit > old_limit:
                raise ValueError(f"预算上限只能收紧（≤{old_limit:.2f}），禁止放宽")
        elif name == "tool_limit_policy":
            new_sub = int(params.get("max_subtasks", 8))
            old_sub = int(os.environ.get("AGENT_MCP_MAX_SUBTASKS", "8"))
            if new_sub > old_sub:
                raise ValueError(f"max_subtasks 只能收紧（≤{old_sub}），禁止放宽")
        elif name == "approval_policy":
            # 审批策略只能增加白名单前缀（收紧 = 更少前缀放行）；允许重新配置
            pass
        else:
            raise ValueError(f"未知内置策略: {name}（仅支持 budget/approval/tool_limit）")
        factory = {
            "budget_policy": lambda: budget_policy_factory(limit_usd=float(params.get("limit_usd", 10.0))),
            "approval_policy": lambda: approval_policy_factory(
                allow_prefixes=[str(p) for p in (params.get("allow_prefixes") or [])]),
            "tool_limit_policy": lambda: tool_limit_policy_factory(
                max_subtasks=int(params.get("max_subtasks", 8)),
                max_parallel=int(params.get("max_parallel", 4))),
        }[name]
        try:
            self.policy_engine.unregister(name)
        except ValueError:
            pass
        self.policy_engine.register(name, factory())
        self.policy_engine.save()
        return {"status": "ok", "policy": name, "params": params}

    def _sink_final_answer(self, agent_id: int, summary: str, session_id: str) -> None:
        """自动沉淀：完成态 summary 含 FINAL_ANSWER: 时写入 kind=final_answer 记忆
        （source=agent:<id>，去首尾空白，空则不写）。best-effort，失败只记日志。"""
        marker = "FINAL_ANSWER:"
        pos = summary.rfind(marker)
        if pos < 0:
            return
        text = summary[pos + len(marker):].strip()
        if not text:
            return
        try:
            self.db.insert_memory(session_id=session_id or "default",
                                  kind="final_answer", content=text,
                                  source=f"agent:{agent_id}")
        except Exception as exc:
            print(f"[dispatcher] memory sink failed for agent {agent_id}: {exc}",
                  file=sys.stderr)

    def _settle_workspace_audit(self, agent_id: int, info: dict) -> None:
        """审计 Diff 结算：把 spawn 前快照与完成态快照比对入库（best-effort）。

        失败必须留痕：写 agent.audit_failed 事件并广播，不得静默吞掉。
        """
        try:
            initial_snap = info.get("initial_snapshot") or {}
            cwd = info.get("cwd") or (self.db.get_agent(agent_id) or {}).get("cwd")
            if not cwd or not os.path.exists(cwd) or not initial_snap:
                return
            final_snap = snapshot_workspace(cwd)
            result = compute_workspace_diff(cwd, initial_snap, final_snap)
            agent = self.db.get_agent(agent_id) or {}
            session_id = str(agent.get("session_id") or "")
            change_of: dict[str, str] = {}
            for rel_path in result["modified"]:
                change_of[rel_path] = "modified"
            for rel_path in result["added"]:
                change_of[rel_path] = "added"
            for rel_path in result["deleted"]:
                change_of[rel_path] = "deleted"
            for rel_path in sorted(change_of):
                self.db.record_file_diff(
                    agent_id=agent_id, session_id=session_id,
                    file_path=rel_path, change_type=change_of[rel_path],
                    diff_content=result["diffs"].get(rel_path, ""))
        except Exception as audit_exc:
            try:
                agent = self.db.get_agent(agent_id) or {}
                seq = self.db.insert_event(
                    agent_id=agent_id, type="agent.audit_failed",
                    payload={"stage": "workspace_diff", "error": str(audit_exc)[:300]},
                    session_id=str(agent.get("session_id") or ""))
                self.broadcaster.publish(
                    {"type": "agent.audit_failed", "agent_id": agent_id,
                     "payload": {"error": str(audit_exc)[:200]}, "seq": seq}, seq=seq)
            except Exception:
                print(f"[audit] diff capture failed for agent {agent_id}: {audit_exc}",
                      file=sys.stderr)

    # ---- 内部 ----

    def _run_worker(self, agent_id: int, target_cli: str, prompt: str,
                    cwd: str, body: dict) -> dict:
        try:
            worker_options = {
                "prompt": prompt,
                "cwd": cwd,
                "permission_mode": body.get("permission_mode") or "plan",
                "model": body.get("model"),
                "max_turns": body.get("max_turns", 8),
                "resume": body.get("resume"),
                "state_dir": self.state_dir,
                "timeout_seconds": body.get("timeout_seconds"),
            }
            if body.get("env") is not None:
                worker_options["env"] = body["env"]
            # 容器沙箱开关（实验性）：默认关闭；设置 AGENT_MCP_SANDBOX_IMAGE 后启用，
            # AGENT_MCP_SANDBOX_NETWORK 非 "none"/"false"/"0"/"off" 时允许容器联网。
            sandbox_image = os.environ.get("AGENT_MCP_SANDBOX_IMAGE")
            if sandbox_image:
                worker_options["sandbox_container"] = sandbox_image
                worker_options["sandbox_network"] = os.environ.get(
                    "AGENT_MCP_SANDBOX_NETWORK", "none")
            # 审计快照：记录启动前工作区状态
            initial_snapshot = snapshot_workspace(cwd)
            info = self._spawn_fn(target_cli, **worker_options)
            info["initial_snapshot"] = initial_snapshot
            info["cwd"] = cwd
            info["body"] = body
        except ResumeUnsupportedError as exc:
            self._fail(agent_id, stop_reason="resume_unsupported", message=str(exc))
            return self._agent_result(agent_id, status="error", error=str(exc))
        except ValueError as exc:
            self._fail(agent_id, stop_reason="cli_missing", message=str(exc))
            return self._agent_result(agent_id, status="error", error=str(exc))
        with self._lock:
            self._workers[agent_id] = info
        # A5: worker 关键信息落库——daemon 重启后据此认领仍存活的 worker（收尸/续等）
        try:
            self.db.set_worker_info(agent_id, json.dumps(
                {k: info.get(k) for k in ("worker_pid", "state_path", "out_path",
                                          "err_path")},
                ensure_ascii=False))
        except Exception as exc:
            print(f"[dispatcher] persist worker_info failed for agent {agent_id}: {exc}",
                  file=sys.stderr)
        self._set_status(agent_id, "running", pid=info["worker_pid"])
        self._broadcast("agent.running", {"agent_id": agent_id,
                                          "pid": info["worker_pid"]}, agent_id)
        # F6: 启 watcher 线程阻塞等 worker 进程退出（proc.wait），退出后调 _check_worker；
        # 不再由 _monitor 轮询扫所有 worker 查 state，空闲 daemon CPU≈0。
        t = threading.Thread(target=self._worker_watcher,
                             args=(agent_id,), daemon=True,
                             name=f"worker-watch-{agent_id}")
        with self._lock:
            self._watchers[agent_id] = t
        t.start()
        return self._agent_result(agent_id, status="running", pid=info["worker_pid"])

    def _worker_watcher(self, agent_id: int) -> None:
        """F6: 阻塞等 worker 进程退出（psutil.Process.wait），退出后调 _check_worker。
        proc.wait 阻塞不轮询，空闲 daemon CPU≈0%；state 文件 finished 仍由 _check_worker 检测。
        注意：_check_worker 可能触发 followup 重 spawn 同 agent_id 的新 watcher；
        finally 仅在自身仍是已注册 watcher 时才 pop，避免误删新 watcher。"""
        pid = None
        my_thread = threading.current_thread()
        try:
            with self._lock:
                info = self._workers.get(agent_id)
                pid = info.get("worker_pid") if info else None
            if pid:
                try:
                    proc = psutil.Process(pid)
                    proc.wait(timeout=None)  # 阻塞至进程退出
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass  # 进程已退出或不可访问 → 直接检查 state
            # 进程已退出 → 检查 state 文件终态（finished/孤儿）
            self._check_worker(agent_id)
        except Exception as exc:
            print(f"[dispatcher] watcher error for agent {agent_id}: {exc}",
                  file=sys.stderr)
        finally:
            with self._lock:
                if self._watchers.get(agent_id) is my_thread:
                    self._watchers.pop(agent_id, None)

    def _set_status(self, agent_id: int, status: str, *, stop_reason: str | None = None,
                    pid: int | None = None, cli_session_id: str | None = None) -> None:
        """状态迁移统一入口：经 state_machine 校验合法迁移。

        终态→running 仅 followup 重启（新 run）豁免；终态→error 仅
        followup 重启失败（_fail）豁免，保证 cli_missing/resume_unsupported
        事件与 error 状态可观察；其余非法迁移抛 ValueError。
        """
        agent = self.db.get_agent(agent_id)
        current = agent["status"] if agent else None
        if current and status != current:
            if current in _TERMINAL and status in ("running", "error"):
                pass  # followup 重启：状态机按单 run 建模，重启/重启失败为显式例外
            else:
                transition(current, status)
        self.db.set_status(agent_id, status, stop_reason=stop_reason, pid=pid,
                           cli_session_id=cli_session_id)
        # F1: 进入终态（或 needs_advisor）时 set 唤醒阻塞的 wait；followup 重启时重置 Event
        with self._lock:
            ev = self._events.get(agent_id)
            if ev is not None:
                if status in _TERMINAL or status == "needs_advisor":
                    ev.set()
                else:
                    ev.clear()  # running/queued：新 run 进行中，重置供下次 wait 阻塞

    def _fail(self, agent_id: int, *, stop_reason: str, message: str,
              error_type: str | None = None, hint: str | None = None) -> None:
        self._release_and_promote(str(agent_id))
        self._set_status(agent_id, "error", stop_reason=stop_reason)
        payload = {"agent_id": agent_id, "stop_reason": stop_reason,
                   "message": message}
        if error_type:
            payload["error_type"] = error_type
        if hint:
            payload["hint"] = hint
        self._broadcast("agent.error", payload, agent_id)

    def _check_worker(self, agent_id: int) -> None:
        """state 文件 finished → 状态迁移 + 广播 + 槽位释放补位。幂等（pop 保护）。
        孤儿检测：state 已写 running 且 worker 进程已死 → _fail worker_died。"""
        orphan_info: dict | None = None
        finished = False
        with self._lock:
            info = self._workers.get(agent_id)
            if info is None:
                return
            state = _read_json(info["state_path"])
            if state.get("status") == "finished":
                self._workers.pop(agent_id, None)
                self._offsets.pop(agent_id, None)
                rc = state.get("process_status", 0)
                timed_out = bool(state.get("timed_out"))
                summary = _final_summary(info["out_path"])
                finished = True
            elif state.get("status") == "running" and not is_pid_running(info.get("worker_pid")):
                # 孤儿检测：仅当 worker 已确认进入 running 态（state 写 running）
                # 却进程已死（崩溃/被外部 kill）才判孤儿；starting/空 state 不判，
                # 避免 worker 启动窗口与 fake-worker 测试误杀
                self._workers.pop(agent_id, None)
                self._offsets.pop(agent_id, None)
                orphan_info = info
        if orphan_info is not None:
            self._fail(agent_id, stop_reason="worker_died",
                       message=f"worker pid {orphan_info.get('worker_pid')} "
                               f"died without finishing",
                       error_type="worker_died",
                       hint="respawn the agent with context from the last run; "
                            "check out/err logs for the crash reason")
            self._maybe_chain(agent_id)  # 排队中的 followup 仍须串联，勿静默丢弃
            return
        if not finished:
            return
        # 审计 Diff 结算（best-effort，失败以 agent.audit_failed 事件留痕）
        self._settle_workspace_audit(agent_id, info)

        agent = self.db.get_agent(agent_id)
        if agent is not None:
            self._ingest_output(agent_id, agent["cli"], info["out_path"],
                                agent["session_id"])
        # C4 verify_command 内嵌：完成态后 daemon 自跑 verify，失败 resume/重 spawn 带失败输出回投
        body = info.get("body") or {}
        verify_command = body.get("verify_command")
        max_fix_attempts = int(body.get("max_fix_attempts") or 0)
        attempts_used = int(info.get("verify_attempts", 0))
        if verify_command and rc == 0 and attempts_used < max_fix_attempts:
            verify_cwd = agent["cwd"] if agent else (body.get("cwd") or "")
            ok, vout = _run_verify(verify_command, verify_cwd,
                                   timeout=float(body.get("verify_timeout_sec") or 300))
            if not ok:
                info["verify_attempts"] = attempts_used + 1
                fix_prompt = (f"上一轮实现的 verify 失败（attempt {attempts_used + 1}/"
                              f"{max_fix_attempts}）。\n{vout}{VERIFY_FIX_INSTRUCTION}")
                # resume 支持的 CLI 走 resume；不支持的走重 spawn 带 context
                resume = body.get("resume") or (agent or {}).get("cli_session_id")
                self._broadcast("agent.verify_failed",
                                {"agent_id": agent_id, "attempt": attempts_used + 1,
                                 "output": vout[-2000:]}, agent_id)
                self.followup({"agent_id": agent_id, "prompt": fix_prompt,
                               "session_id": (agent or {}).get("session_id"),
                               "resume": resume, "interrupt": False,
                               "verify_command": verify_command,
                               "max_fix_attempts": max_fix_attempts,
                               "_verify_attempts": attempts_used + 1})
                return  # verify 回投接管，不进下面的终态迁移
            self._broadcast("agent.verify_passed", {"agent_id": agent_id}, agent_id)
        if timed_out:
            # 超时 → incomplete（可 resume/重派），事件沿用 agent.terminated + stop_reason
            # P5: 带 error_type=timeout + hint，结构化错误便主 agent 自动化处理
            # 顺序：事件先落库再置终态——_set_status 的 ev.set() 唤醒 wait 后，
            # 其 fast-path 兜底需能从 DB 取到 terminated 事件（事件晚于状态会取空）
            self._broadcast("agent.terminated", {"agent_id": agent_id,
                                                 "stop_reason": "timeout",
                                                 "error_type": "timeout",
                                                 "hint": "task timed out; "
                                                         "resume with followup_task "
                                                         "(resume=true) or re-spawn "
                                                         "with context from last run",
                                                 "summary": summary}, agent_id)
            self._set_status(agent_id, "incomplete", stop_reason="timeout")
        elif rc == 0:
            # E2 needs_advisor：子代理回 NEEDS_DECISION: + 理由 → 标 needs_advisor，主 agent wait 收到此态才介入
            needs_advisor_match = re.search(r"NEEDS_DECISION:\s*(.+?)(?:\n|$)",
                                            summary, re.DOTALL)
            if needs_advisor_match and "why" in summary.lower():
                self._broadcast("agent.needs_advisor",
                                {"agent_id": agent_id,
                                 "question": needs_advisor_match.group(1).strip()[:1000]},
                                agent_id)
                self._set_status(agent_id, "needs_advisor",
                                stop_reason="needs_decision")
            else:
                self._broadcast("agent.terminated", {"agent_id": agent_id,
                                                    "stop_reason": "end_turn",
                                                    "summary": summary}, agent_id)
                self._set_status(agent_id, "terminated", stop_reason="end_turn")
                # 记忆银行：完成态自动沉淀 FINAL_ANSWER → kind=final_answer 记忆
                self._sink_final_answer(agent_id, summary, (agent or {}).get("session_id") or "default")
                # C3 token_budget 降档：完成态后判超额，触发 followup 用低档 model 重跑（不运行中换）
                self._maybe_downgrade_on_budget(agent_id, agent, body)
        else:
            self._set_status(agent_id, "error", stop_reason="cli_exit_nonzero")
            self._broadcast("agent.error", {"agent_id": agent_id,
                                            "stop_reason": "cli_exit_nonzero",
                                            "error_type": "cli_exit_nonzero",
                                            "message": f"cli exited {rc}",
                                            "hint": "read out/err logs for the CLI error; "
                                                    "respawn with adjusted prompt or permission_mode"},
                                            agent_id)
        self._release_and_promote(str(agent_id))
        self._maybe_chain(agent_id)

    def _maybe_downgrade_on_budget(self, agent_id: int, agent: dict | None,
                                    body: dict) -> None:
        """token_budget 超额后的降档决策（完成态判定，运行中不动）。

        两种模式：
        - 默认（未配置 downgrade_chain，v2 行为不变）：按 MODEL_DOWNGRADE
          同 CLI 降一档，仅广播 agent.budget_downgrade 提示主 Agent 自行决定；
        - B3 用户预声明链（body.downgrade_chain=[{"cli","model"},...]，opt-in）：
          按链逐步广播明确的下一跳组合（含 to_cli），主 Agent 可据此直接
          followup(target_cli=..., model=...) 跨底座重跑。
          系统永不擅自更换用户未声明的组合；链走完即止。"""
        budget = float(body.get("token_budget") or 0)
        if budget <= 0 or agent is None:
            return
        totals = self.db.usage_total(agent_id)
        used = int(totals.get("input_tokens", 0)) + int(totals.get("output_tokens", 0))
        if used <= budget:
            return
        if agent.get("status") != "terminated":  # 只对成功态降档重跑
            return
        current_model = agent.get("model") or body.get("model")

        # B3：用户预声明降档链（opt-in）
        chain = body.get("downgrade_chain")
        if isinstance(chain, list) and chain:
            step = int(body.get("_downgrade_step") or 0)
            if step >= len(chain):
                return  # 链已走完，不连降
            target = chain[step] if isinstance(chain[step], dict) else {}
            target_cli = str(target.get("cli") or "").strip()
            if not target_cli:
                return
            self._broadcast("agent.budget_downgrade",
                            {"agent_id": agent_id,
                             "from": current_model,
                             "to": target.get("model"),
                             "from_cli": agent.get("cli"),
                             "to_cli": target_cli,
                             "chain_step": step + 1,
                             "chain_len": len(chain),
                             "used_tokens": used,
                             "budget": budget,
                             "reason": "token_budget exceeded; user-declared "
                                       "downgrade chain",
                             "hint": f"followup(agent_id={agent_id}, "
                                     f"target_cli='{target_cli}', "
                                     f"prompt=original task) to continue on the "
                                     f"user-declared cheaper harness"},
                            agent_id)
            return

        downgraded = MODEL_DOWNGRADE.get(current_model or "")
        if not downgraded:
            return  # 已在最低档或无映射，不连降（v2 原行为）
        self._broadcast("agent.budget_downgrade",
                        {"agent_id": agent_id, "from": current_model,
                         "to": downgraded, "used_tokens": used,
                         "budget": budget}, agent_id)

    def _tail_progress(self, agent_id: int) -> None:
        """运行中增量 tail：新字节 → touch_activity 心跳 + 轻量 delta 广播。

        只读 out/err 的新增字节（offset 幂等），提取可读进度行（atomcode 的
        [thinking]/[tool→] 等）→ agent.message_delta 广播；权威事件
        （message/usage/terminated）仍由完成态 _ingest_output 一次性产出，
        这里不落库权威事件（db.insert_event 对 message_delta 本就返回 None）。
        """
        with self._lock:
            info = self._workers.get(agent_id)
            if info is None:
                return
            offsets = self._offsets.setdefault(agent_id, {})
        new_text = ""
        for key in ("out_path", "err_path"):
            path = Path(info[key])
            try:
                size = path.stat().st_size
            except OSError:
                continue
            start = offsets.get(key, 0)
            if size == start:
                continue
            if size < start:
                # 日志被截断/轮转（size 回退）→ 重置 offset 从头读，恢复心跳与 delta
                offsets[key] = 0
                start = 0
            try:
                with path.open("r", encoding="utf-8", errors="replace") as f:
                    f.seek(start)
                    chunk = f.read(size - start)
            except OSError:
                continue
            offsets[key] = size
            new_text += chunk
        if not new_text.strip():
            return
        self.db.touch_activity(agent_id)
        visible = _progress_lines(new_text)
        if visible:
            # delta 只广播不落库；直接 publish（_broadcast 对 delta 不广播）
            self.broadcaster.publish({"type": "agent.message_delta",
                                      "agent_id": agent_id,
                                      "payload": {"delta": visible},
                                      "seq": None}, seq=None)

    def _liveness_evidence(self, agent_id: int, info: dict | None) -> str:
        """F4: 存活证据改读 updated_at 与当前差值判断健康（心跳线程 1s 更新），
        不每次 stat pid + log mtime。updated_at 秒级活→healthy；超阈值给补充证据。"""
        agent = self.db.get_agent(agent_id)
        if agent is None:
            return "agent not found"
        updated = agent.get("updated_at")
        if not updated:
            return "no updated_at (stale record)"
        try:
            ts = datetime.fromisoformat(updated)
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            age = (datetime.now(timezone.utc) - ts).total_seconds()
        except (ValueError, TypeError):
            return f"updated_at={updated} (unparseable)"
        if age <= 3.0:
            return f"updated_at {age:.1f}s ago (alive, heartbeat healthy)"
        # 超 3s 无心跳更新：给补充证据（worker pid + 日志大小，低频 stat）
        parts = [f"updated_at {age:.1f}s ago (stale heartbeat)"]
        if info:
            pid = info.get("worker_pid")
            parts.append(f"worker_pid={pid} alive={bool(is_pid_running(pid))}")
        else:
            parts.append("no worker info (queued)")
        return "; ".join(parts)

    def _liveness_struct(self, agent_id: int, info: dict | None) -> dict[str, bool]:
        """L2: 结构化存活证据——worker_pid_alive/log_growing/healthy 三布尔。
        healthy = updated_at 秒级活（心跳 1s 更新）即 ≤3s。"""
        agent = self.db.get_agent(agent_id)
        result: dict[str, bool] = {"worker_pid_alive": False,
                                   "log_growing": False, "healthy": False}
        if agent is None:
            return result
        pid = info.get("worker_pid") if info else None
        result["worker_pid_alive"] = is_pid_running(pid) if pid else False
        # log_growing：out_path 大小 >0 即有输出增长
        if info and "out_path" in info:
            try:
                result["log_growing"] = Path(info["out_path"]).stat().st_size > 0
            except OSError:
                pass
        updated = agent.get("updated_at")
        if updated:
            try:
                ts = datetime.fromisoformat(updated)
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                age = (datetime.now(timezone.utc) - ts).total_seconds()
                result["healthy"] = age <= 3.0
            except (ValueError, TypeError):
                pass
        return result

    def _maybe_chain(self, agent_id: int) -> None:
        """该 agent 有排队中的 followup → 重新占槽运行（同 id run 串联）。

        SlotScheduler 对"已在 active"的 key 不入队，followup 由 Dispatcher
        自己记 pending，完成时在此补占槽；若槽位已被其他排队任务取走，
        acquire 会正常入队，由后续补位触发。
        """
        with self._lock:
            has_pending = agent_id in self._pending
        if not has_pending:
            return
        if self._scheduler.acquire(str(agent_id)):
            params = self._take_pending(agent_id)
            if params is not None:
                self._run_worker(agent_id, *params)
            else:
                self._release_and_promote(str(agent_id))  # 竞态：无参可取，释放占位

    def _release_and_promote(self, key: str) -> None:
        promoted = self._scheduler.release(key)
        if promoted:
            self._start_queued(promoted)

    def _start_queued(self, key: str) -> None:
        params = self._take_pending(int(key))
        if params is None:
            self._release_and_promote(key)  # 被中断的排队任务：释放占位
            return
        self._run_worker(int(key), *params)

    def _wait_result(self, agent: dict, summary: str,
                     summary_chars: int = 600, return_ref: bool = False) -> dict:
        if agent["status"] == "terminated":
            # summary 兜底：与 monitor 竞争时从已落库的 terminated 事件取
            # （按会话过滤 + 大 limit：events_since 默认取最早 limit 条，
            # 真实库事件超 1000 后旧实现取不到最新事件 → summary 空）
            if not summary:
                summary = self._last_event_payload(
                    agent["id"], "agent.terminated",
                    session_id=agent.get("session_id")).get("summary", "")
            final = _extract_final_answer(summary, summary_chars)
            # P2: 结构化返回——usage 五元组摘要 + events 压缩
            usage = self.db.usage_total(agent["id"])
            usage_summary = {
                "input_tokens": int(usage.get("input_tokens") or 0),
                "output_tokens": int(usage.get("output_tokens") or 0),
                "cache_read": int(usage.get("cache_read") or 0),
                "cache_creation": int(usage.get("cache_creation") or 0),
                "cost_usd": round(float(usage.get("cost_usd") or 0), 4),
            }
            raw_events = self.db.events_since(
                0, session_id=agent["session_id"],
                compress_consumed=True, keep_recent=5)
            events = [e for e in raw_events if e.get("agent_id") == agent["id"]]
            # B4: 附带审计变更清单（编排层 diff-based 审查与监控展示的数据源）
            file_diffs = [{"file_path": d.get("file_path"),
                           "change_type": d.get("change_type")}
                          for d in self.db.get_file_diffs(
                              agent_id=agent["id"])[:20]]
            if return_ref:
                result = self._agent_result(
                    agent["id"], status="terminated",
                    stop_reason=agent["stop_reason"],
                    summary=final,
                    usage=usage_summary,
                    events_compressed=True,
                    events=events,
                    ref={"agent_id": agent["id"],
                         "out_path": summary},
                    summary_preview=final[:200])
            else:
                result = self._agent_result(
                    agent["id"], status="terminated",
                    stop_reason=agent["stop_reason"], summary=final,
                    usage=usage_summary, events_compressed=True,
                    events=events)
            result["file_diffs"] = file_diffs
            return result
        if agent["status"] == "error":
            msg = summary.strip() or agent.get("stop_reason", "")
            msg = _extract_final_answer(msg, summary_chars)
            return self._agent_result(
                agent["id"], status="error", stop_reason=agent["stop_reason"],
                message=msg)
        return self._agent_result(agent["id"], status=agent["status"],
                                  stop_reason=agent["stop_reason"])

    def _agent_result(self, agent_id: int, *, compress_events: bool = False,
                     since_seq: int = 0, **payload: Any) -> dict[str, Any]:
        agent = self.db.get_agent(agent_id)
        result = {"agent_id": agent_id, **payload}
        if agent:
            result.update({
                "session_id": agent["session_id"],
                "created_at": agent["created_at"],
                "updated_at": agent["updated_at"],
            })
        if compress_events and agent:
            events = self.db.events_since(since_seq, session_id=agent["session_id"],
                                          compress_consumed=True)
            result["events"] = [e for e in events if e.get("agent_id") == agent_id]
            result["next_seq"] = events[-1]["seq"] if events else since_seq
        return result

    def _last_event_payload(self, agent_id: int, type_: str,
                            session_id: str | None = None) -> dict:
        """查指定 agent 最近一条 type_ 事件的 payload。

        events_since 按 seq 升序且默认 limit=1000（最早 1000 条）——真实库事件
        积累超限后须按会话过滤并放大 limit，否则取不到最新事件。
        """
        for e in reversed(self.db.events_since(0, session_id=session_id, limit=5000)):
            if e.get("agent_id") == agent_id and e.get("type") == type_:
                return e.get("payload") or {}
        return {}

    def _ingest_output(self, agent_id: int, cli: str, out_path: Path | str,
                       session_id: str) -> None:
        """worker 完成后一次性解析 stdout 流 → 事件落库 + 广播 + usage 累计。

        parse_stream 返回 (events, usage)：普通事件落库并广播；
        agent.message_delta 只广播不落库（前端打字机）；parse_stream 产出的
        agent.terminated 由 monitor 统一迁移广播，这里仅回填其 session_id
        到 cli_session_id（resume 用）。usage 为聚合 dict 无 model 拆分，
        统一按 model="aggregate" 落库（简单为准）。
        """
        try:
            lines = Path(out_path).read_text(encoding="utf-8",
                                             errors="replace").splitlines()
            if not lines:
                return
            adapter = get_adapter(cli)
        except Exception as exc:
            # 适配器缺失（unknown CLI）属系统防御分支：spawn 有 enum 校验不会触发，
            # 保持原 noop 契约（stderr 诊断即可，不落事件）
            print(f"[dispatcher] ingest skipped for agent {agent_id}: {exc}",
                  file=sys.stderr)
            return
        try:
            events, usage = adapter.parse_stream(lines)
        except Exception as exc:
            print(f"[dispatcher] ingest failed for agent {agent_id}: {exc}",
                  file=sys.stderr)
            # 不静默：parse 失败广播可见事件，wait hint 与监控页可观测，
            # 避免 terminated 已广播但 usage 缺失时无从排查
            self._broadcast("agent.ingest_failed", {
                "agent_id": agent_id, "error": str(exc)[:500],
            }, agent_id)
            return
        for ev in events:
            typ = ev.get("type")
            payload = ev.get("payload") or {}
            if typ == "agent.terminated":
                sid = payload.get("session_id")
                if sid:
                    agent = self.db.get_agent(agent_id)
                    if agent:
                        self.db.set_status(agent_id, agent["status"],
                                           cli_session_id=str(sid))
                continue
            # D4 事件分层：tool_use/tool_result payload 超 2KB 落 verbose 层，其余 authority
            ev_tier = "verbose" if (typ in ("agent.tool_use", "agent.tool_result")
                                    and len(json.dumps(payload, ensure_ascii=False)) > 2048) else "authority"
            seq = self.db.insert_event(agent_id=agent_id, type=typ,
                                       payload=payload, session_id=session_id,
                                       tier=ev_tier)
            self.broadcaster.publish({"type": typ, "agent_id": agent_id,
                                      "payload": payload, "seq": seq}, seq=seq)
        if usage:
            # B2 usage 结算统一口径：按适配器声明的 semantics 处理。
            # authoritative 且总量全空 → 不覆盖既有累计（防尾随零清账）；
            # cumulative → 最新累计值直接覆盖（禁止二次累加）。
            semantics = getattr(adapter, "usage_semantics", "authoritative")
            empty_totals = not any(
                int(usage.get(k) or 0)
                for k in ("input_tokens", "output_tokens", "cache_creation",
                          "cache_read")) and not (usage.get("cost_usd") or 0.0)
            skip_upsert = semantics == "authoritative" and empty_totals
            if not skip_upsert:
                self.db.upsert_usage(agent_id=agent_id, model="aggregate",
                                     input_tokens=usage.get("input_tokens", 0),
                                     output_tokens=usage.get("output_tokens", 0),
                                     cache_creation=usage.get("cache_creation", 0),
                                     cache_read=usage.get("cache_read", 0),
                                     cost_usd=usage.get("cost_usd", 0.0) or 0.0)
            # v0.3 策略：真实成本增量回灌预算（H1：usage_delta 的唯一生产者）
            decision = self.policy_engine.evaluate(PolicyEvent(
                "usage_delta", data={"cost": usage.get("cost_usd", 0.0) or 0.0,
                                     "agent_id": agent_id}))
            # A5：热路径不再同步写盘——策略状态由心跳线程周期 save_if_dirty 落盘
            if decision.result != PolicyResult.ALLOW.value:
                self._broadcast("policy_decision", {
                    "name": decision.name, "result": decision.result,
                    "reason": decision.reason,
                }, agent_id)
            # D2 per-call usage jsonl：每 worker run 一行落盘，Daily Auditor 数据基础
            try:
                usage_dir = self.state_dir / "usage"
                usage_dir.mkdir(parents=True, exist_ok=True)
                if os.name != "nt":
                    os.chmod(usage_dir, 0o700)
                record = {"agent_id": agent_id, "session_id": session_id,
                          "cli": cli, "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                                           time.gmtime()),
                          **usage}
                with (usage_dir / f"{agent_id}.jsonl").open("a", encoding="utf-8") as f:
                    f.write(json.dumps(record, ensure_ascii=False) + "\n")
            except Exception as exc:
                print(f"[dispatcher] usage jsonl write failed for agent {agent_id}: {exc}",
                      file=sys.stderr)

    def _broadcast(self, type_: str, payload: dict, agent_id: int) -> None:
        agent = self.db.get_agent(agent_id)
        session_id = agent["session_id"] if agent else "default"
        seq = self.db.insert_event(agent_id=agent_id, type=type_, payload=payload,
                                   session_id=session_id)
        if seq is not None:
            self.broadcaster.publish({"type": type_, "agent_id": agent_id,
                                      "payload": payload, "seq": seq}, seq=seq)

    @staticmethod
    def _require_session(body: dict, agent: dict) -> None:
        requested = body.get("session_id")
        if requested and requested != agent.get("session_id"):
            raise ValueError(
                f"agent {agent['id']} {SESSION_MISMATCH_MARK} {requested} "
                f"(belongs to session {agent.get('session_id')}); cross-session "
                f"operations are not allowed — respawn the agent in the current "
                f"session instead of reusing its agent_id")

    @staticmethod
    def _require_id(body: dict) -> int:
        agent_id = body.get("agent_id")
        if not agent_id:
            raise ValueError("agent_id is required")
        return int(agent_id)


def main() -> int:
    parser = argparse.ArgumentParser(description="Agent MCP daemon")
    parser.add_argument("--port", type=int,
                        default=int(os.environ.get("AGENT_MCP_PORT", DEFAULT_PORT)))
    parser.add_argument("--state-dir", type=Path, default=DEFAULT_STATE_DIR)
    parser.add_argument("--web-root", type=Path, default=DEFAULT_WEB_ROOT)
    args = parser.parse_args()

    state_dir = args.state_dir
    state_dir.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        os.chmod(state_dir, 0o700)

    lock_path = state_dir / "daemon.lock"
    lock_handle = None
    if os.name != "nt":
        # POSIX：flock 排他锁跨进程互斥（进程退出自动释放，无残留问题）
        import fcntl
        lock_handle = open(lock_path, "a+")
        os.chmod(lock_path, 0o600)
        try:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            print("daemon already running (startup lock held)", file=sys.stderr)
            return 0
    elif lock_path.is_file():
        # Windows 无 flock：退回 pid 活性启发式（原子性有限，文档注明）
        try:
            lock = json.loads(lock_path.read_text(encoding="utf-8"))
            if is_pid_running(lock.get("pid")):
                print(f"daemon already running (pid {lock['pid']})", file=sys.stderr)
                return 0
        except Exception:
            pass  # 残留/损坏锁，覆盖

    token = _load_or_create_token(state_dir)
    db = DB(state_dir / "daemon.db")
    # 自定义 CLI 适配器：<state_dir>/custom-clis/*.json，启动即注册（首启耗时并入矩阵）
    for cli_name in load_custom_adapters(state_dir):
        try:
            _CLI_FIRST_START_SECONDS[cli_name] = get_adapter(cli_name).first_start_seconds
        except Exception:
            pass
    # D3+D4: 启动时主动清理过期 spawn_cache + 7 天前 events，并启动 6h 循环 Timer
    for purge in (db.purge_spawn_cache, db.purge_events):
        try:
            purge()
        except Exception:
            pass  # 启动清理失败不致命
    def _purge_cycle() -> None:
        """D3+D4: 每 6h 清一次 spawn_cache + events，循环 Timer 链。"""
        for purge in (db.purge_spawn_cache, db.purge_events):
            try:
                purge()
            except Exception:
                pass
        threading.Timer(6 * 3600, _purge_cycle).start()
    threading.Timer(6 * 3600, _purge_cycle).start()

    broadcaster = EventBroadcaster()
    dispatcher = Dispatcher(db=db, broadcaster=broadcaster, state_dir=state_dir)
    try:
        srv = DaemonHTTPServer(("127.0.0.1", args.port), args.web_root, token=token,
                           db=db, dispatcher=dispatcher, broadcaster=broadcaster)
    except OSError as exc:
        # D6: bind 失败明确报 port conflict 而非通用错误
        import errno
        if exc.errno in (errno.EADDRINUSE, errno.EACCES):
            print(f"daemon startup failed: port conflict on {args.port}"
                  f" (another process already listening)", file=sys.stderr)
        else:
            print(f"daemon startup failed: bind error on port {args.port}: {exc}",
                  file=sys.stderr)
        dispatcher.stop()
        return 1

    lock_data = {"pid": os.getpid(), "ts": time.time()}
    if lock_handle is not None:
        lock_handle.seek(0)
        lock_handle.truncate()
        lock_handle.write(json.dumps(lock_data))
        lock_handle.flush()
    else:
        _write_private(lock_path, lock_data)
    # F8 配合 mcp_server.ensure_daemon 的拉起锁：锁文件在 dispatcher.start 前就写好，
    # 让 ensure_daemon spawn 后释放 _STARTUP_LOCK，其他客户端可凭 pid 探测发现 daemon；
    # HTTP 套接字已 bind（srv 构造时），serve_forever 立即接 accept，探测零等待。
    dispatcher.start()

    def _heartbeat() -> None:
        while True:
            time.sleep(HEARTBEAT_SECONDS)
            broadcaster.heartbeat_all()

    threading.Thread(target=_heartbeat, daemon=True).start()

    try:
        print(f"agent-mcp daemon on http://127.0.0.1:{srv.server_address[1]}", file=sys.stderr)
        srv.serve_forever()
    finally:
        dispatcher.stop()
        srv.server_close()
        if os.name == "nt":
            lock_path.unlink(missing_ok=True)  # POSIX 保留文件，flock 随进程退出自动释放
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
