# Agent MCP 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 codex 的 grok-cli MCP 重构为通用多 agent 调度 MCP：三主载体（omp/codex/claude）通过 8 个工具（V2 六原语 + 2 监控）派发任务到四 CLI（claude/grok/opencode/omp），带 SQLite 存储、SSE 实时 Claude UI 风格知识导图网页、配套 skill。

**Architecture:** MCP 薄层（stdio，零依赖，无状态）→ 常驻 daemon（Python stdlib + psutil：四 CLI 适配器统一解析事件流 → SQLite WAL 单写者 → SSE 统一广播 + HTTP 控制 + 静态托管）→ 单文件前端。三主载体注册同一 MCP server，clientInfo.name 识别 host 做会话隔离。

**Tech Stack:** Python 3.12（stdlib: http.server/sqlite3/json/subprocess + psutil 5.9）、单文件 HTML/原生 JS、SSE（非 WebSocket）、SQLite WAL。

**参考设计:** `docs/plans/2026-08-03-agent-mcp-redesign-design.md`（已批准 v0.3）

---

## Phase 0: 四 CLI 能力实测

### Task 0: 能力矩阵实测

**Files:**
- Create: `docs/capability-matrix.md`（实测结果记录）

**Step 1: 实测 claude（已完成，记录结果）**

Run: `claude -p "回复 OK" --output-format json`
Confirmed: result 事件含 `stop_reason`（end_turn）/ `session_id` / `total_cost_usd` / `usage`（input_tokens/cache_creation_input_tokens/cache_read_input_tokens/output_tokens）/ `modelUsage`（按模型拆分含 costUSD）。`--verbose` 时含 assistant/message 流。`--input-format stream-json` 支持运行中注入。

**Step 2: 实测 grok（后台任务 bjmeoweps 继续验证）**

Run: `/Users/cc/.grok/bin/grok --single "回复 OK" --output-format json`
Expected: 确认 `--single` + `--output-format json|streaming-messages-json` 输出结构（usage/sessionId/stopReason）。注意首次运行慢（模型发现）。

**Step 3: 实测 opencode**

Run: `opencode run "回复 OK" --format json`
Expected: 确认事件流结构（message/tool/usage 事件）。

**Step 4: 实测 omp headless**

Run: `omp --help`（确认二进制与 headless 驱动方式）
Expected: 确认 omp 的 CLI 入口、非交互模式、输出格式。若不可 headless，适配器降级为"仅 spawn 交互进程 + 日志 tail"并记录。

**Step 5: 记录 + 提交**

在 `docs/capability-matrix.md` 填表（事件格式/流式输入/resume/usage 字段/权限模式/Windows 二进制）。测试结论回填适配器设计。

```bash
git add docs/capability-matrix.md
git commit -m "docs: record four CLI capability matrix findings"
```

---

## Phase 1: 核心库（agent_mcp/ 包）

### Task 1: 项目骨架 + 规范化事件 schema

**Files:**
- Create: `agent_mcp/__init__.py`
- Create: `agent_mcp/events.py`
- Test: `tests/test_events.py`

**Step 1: 写失败测试**

```python
# tests/test_events.py
import pytest
from agent_mcp.events import Event, EVENT_TYPES, normalize_event

def test_event_roundtrip():
    e = Event(agent_id="a1", type="agent.message", payload={"text": "hi"}, session_id="s1")
    d = e.to_dict()
    assert normalize_event(d) == e

def test_normalize_unknown_type_rejected():
    with pytest.raises(ValueError):
        normalize_event({"agent_id": "a1", "type": "bogus.type"})

def test_delta_not_persisted_flag():
    e = Event(agent_id="a1", type="agent.message_delta", payload={})
    assert not e.persist

def test_event_types_exist():
    for t in ("agent.spawned", "agent.running", "agent.message", "agent.message_delta",
              "agent.tool_use", "agent.tool_result", "agent.usage", "agent.thread_message_sent",
              "agent.thread_message_received", "agent.idle", "agent.terminated",
              "agent.error", "agent.cancelled"):
        assert t in EVENT_TYPES
```

**Step 2: 跑测试确认失败** — `python3 -m pytest tests/test_events.py -v` → ImportError

**Step 3: 最小实现**

```python
# agent_mcp/events.py
from __future__ import annotations
import json
from dataclasses import dataclass, field, asdict
from typing import Any

EVENT_TYPES = frozenset({
    "agent.spawned", "agent.running", "agent.message", "agent.message_delta",
    "agent.tool_use", "agent.tool_result", "agent.usage",
    "agent.thread_message_sent", "agent.thread_message_received",
    "agent.idle", "agent.terminated", "agent.error", "agent.cancelled",
})
NON_PERSISTED = frozenset({"agent.message_delta"})

@dataclass
class Event:
    agent_id: str
    type: str
    payload: dict[str, Any] = field(default_factory=dict)
    session_id: str = ""
    seq: int | None = None
    created_at: str = ""

    @property
    def persist(self) -> bool:
        return self.type not in NON_PERSISTED

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

def normalize_event(raw: dict[str, Any]) -> Event:
    if not isinstance(raw, dict) or raw.get("type") not in EVENT_TYPES:
        raise ValueError(f"unknown or missing event type: {raw.get('type')!r}")
    return Event(
        agent_id=str(raw.get("agent_id", "")),
        type=raw["type"],
        payload=raw.get("payload") or {},
        session_id=str(raw.get("session_id", "")),
        seq=raw.get("seq"),
        created_at=str(raw.get("created_at", "")),
    )

def event_to_json(event: Event) -> str:
    return json.dumps(event.to_dict(), ensure_ascii=False, separators=(",", ":"))
```

**Step 4: 跑测试确认通过** — 全 PASS

**Step 5: 提交**

```bash
git add agent_mcp/ tests/
git commit -m "feat: add event schema with normalized event types"
```

---

### Task 2: 状态机 + 退出码判定表

**Files:**
- Create: `agent_mcp/state_machine.py`
- Test: `tests/test_state_machine.py`

**Step 1: 写失败测试**

```python
# tests/test_state_machine.py
import pytest
from agent_mcp.state_machine import (
    STATUS_QUEUED, STATUS_RUNNING, STATUS_TERMINATED, STATUS_ERROR,
    STATUS_CANCELLED, STATUS_INCOMPLETE,
    transition, classify_exit, stop_reason_for_exit,
)

def test_valid_transitions():
    assert transition(STATUS_QUEUED, STATUS_RUNNING) == STATUS_RUNNING
    assert transition(STATUS_RUNNING, STATUS_TERMINATED) == STATUS_TERMINATED

def test_invalid_transition_raises():
    with pytest.raises(ValueError):
        transition(STATUS_TERMINATED, STATUS_RUNNING)

def test_exit_code_zero_with_result_is_end_turn():
    assert stop_reason_for_exit(0, has_result=True) == "end_turn"

def test_exit_nonzero_with_error_is_error():
    assert stop_reason_for_exit(1, has_error=True) == "retries_exhausted"

def test_signal_killed_is_cancelled():
    # -15 = SIGTERM
    assert stop_reason_for_exit(-15, has_result=False) == "interrupted"

def test_daemon_restart_marker():
    assert stop_reason_for_exit(None, daemon_restart=True) == "daemon_restart"
```

**Step 2: 跑测试确认失败**

**Step 3: 最小实现**

```python
# agent_mcp/state_machine.py
from __future__ import annotations

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_TERMINATED = "terminated"
STATUS_ERROR = "error"
STATUS_CANCELLED = "cancelled"
STATUS_INCOMPLETE = "incomplete"

TERMINAL = frozenset({STATUS_TERMINATED, STATUS_ERROR, STATUS_CANCELLED, STATUS_INCOMPLETE})

_TRANSITIONS = {
    STATUS_QUEUED: {STATUS_RUNNING, STATUS_ERROR, STATUS_CANCELLED},
    STATUS_RUNNING: {STATUS_TERMINATED, STATUS_ERROR, STATUS_CANCELLED, STATUS_INCOMPLETE},
}

def transition(current: str, target: str) -> str:
    allowed = _TRANSITIONS.get(current)
    if allowed is None or target not in allowed:
        raise ValueError(f"invalid transition: {current} -> {target}")
    return target

def stop_reason_for_exit(exit_code: int | None, *, has_result: bool = False,
                         has_error: bool = False, daemon_restart: bool = False,
                         timed_out: bool = False) -> str:
    if daemon_restart:
        return "daemon_restart"
    if timed_out:
        return "timeout"
    if exit_code is None:
        return "unknown"
    if exit_code == 0 and has_result:
        return "end_turn"
    if exit_code != 0 and has_error:
        return "retries_exhausted"
    if exit_code < 0:
        return "interrupted"
    if exit_code != 0:
        return "error_exit"
    return "no_result"

def classify_exit(exit_code: int | None, *, has_result: bool = False,
                  has_error: bool = False, daemon_restart: bool = False,
                  timed_out: bool = False) -> str:
    reason = stop_reason_for_exit(exit_code, has_result=has_result, has_error=has_error,
                                  daemon_restart=daemon_restart, timed_out=timed_out)
    if reason == "end_turn":
        return STATUS_TERMINATED
    if reason in ("interrupted",):
        return STATUS_CANCELLED
    if reason in ("timeout",):
        return STATUS_INCOMPLETE
    return STATUS_ERROR
```

**Step 4: 跑测试确认通过**

**Step 5: 提交** — `feat: add agent state machine with exit classification`

---

### Task 3: SQLite 存储层（WAL · 单写者 · 批量 · 保留策略）

**Files:**
- Create: `agent_mcp/db.py`
- Test: `tests/test_db.py`

**Step 1: 写失败测试**

```python
# tests/test_db.py
import sqlite3
from agent_mcp.db import DB

def test_agent_crud_and_tree(tmp_path):
    db = DB(tmp_path / "test.db")
    aid = db.insert_agent(parent_id=None, session_id="s1", task_name="/root",
                          cli="claude", model="x", cwd=str(tmp_path))
    cid = db.insert_agent(parent_id=aid, session_id="s1", task_name="/root/t1",
                          cli="grok", model="y", cwd=str(tmp_path))
    db.set_status(cid, "running")
    db.set_status(cid, "terminated", stop_reason="end_turn")
    row = db.get_agent(cid)
    assert row["status"] == "terminated" and row["stop_reason"] == "end_turn"
    assert row["parent_id"] == aid

def test_events_are_sequence_and_persist_flag(tmp_path):
    db = DB(tmp_path / "test.db")
    e1 = db.insert_event(agent_id="a", type="agent.message", payload={"text": "x"}, session_id="s1")
    e2 = db.insert_event(agent_id="a", type="agent.message_delta", payload={"d": "x"}, session_id="s1")
    assert e1 == 1 and e2 == 2  # delta 也占 seq 但标记 non-persist? no—
    # delta 不落库：insert_event 返回 None
    rows = db.events_since(0, session_id="s1")
    assert len(rows) == 1 and rows[0]["type"] == "agent.message"

def test_usage_projection_and_dedupe(tmp_path):
    db = DB(tmp_path / "test.db")
    db.upsert_usage(agent_id="a", model="m1", input_tokens=10, output_tokens=5,
                    cache_creation=0, cache_read=0, cost_usd=0.1)
    db.upsert_usage(agent_id="a", model="m1", input_tokens=3, output_tokens=1,
                    cache_creation=0, cache_read=0, cost_usd=0.05)  # 同 message 再次上报 → 覆盖
    total = db.usage_total(agent_id="a")
    assert total["input_tokens"] == 3

def test_session_scoping(tmp_path):
    db = DB(tmp_path / "test.db")
    db.insert_agent(parent_id=None, session_id="s1", task_name="/root", cli="c", cwd=".")
    db.insert_agent(parent_id=None, session_id="s2", task_name="/root", cli="c", cwd=".")
    assert len(db.agents_by_session("s1")) == 1
    assert len(db.agents_by_session(None)) == 2
```

**Step 2: 跑测试确认失败**

**Step 3: 最小实现**

```python
# agent_mcp/db.py
from __future__ import annotations
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER, session_id TEXT NOT NULL, task_name TEXT NOT NULL,
  cli TEXT NOT NULL, model TEXT, cwd TEXT, permission_mode TEXT,
  status TEXT NOT NULL DEFAULT 'queued', stop_reason TEXT,
  created_at TEXT, updated_at TEXT, finished_at TEXT,
  pid INTEGER, cli_session_id TEXT, command_summary TEXT
);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL, agent_id INTEGER, type TEXT NOT NULL,
  payload TEXT NOT NULL, created_at TEXT
);
CREATE TABLE IF NOT EXISTS usage (
  agent_id INTEGER NOT NULL, model TEXT NOT NULL,
  input_tokens INTEGER, output_tokens INTEGER,
  cache_creation INTEGER, cache_read INTEGER, cost_usd REAL, ts TEXT,
  PRIMARY KEY (agent_id, model)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL, role TEXT, content TEXT, ts TEXT
);
"""

class DB:
    def __init__(self, path: Path | str, *, max_events: int = 100_000,
                 retention_days: int = 7, max_messages_per_agent: int = 500):
        self.path = Path(path)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.executescript(SCHEMA)
        self.max_events = max_events
        self.retention_days = retention_days
        self.max_messages_per_agent = max_messages_per_agent
        if os.name != "nt":
            os.chmod(self.path, 0o600)

    def _utc(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def insert_agent(self, *, parent_id, session_id, task_name, cli, model=None,
                     cwd=None, permission_mode=None, command_summary=None) -> int:
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO agents (parent_id, session_id, task_name, cli, model, cwd,"
                " permission_mode, status, created_at, updated_at, command_summary)"
                " VALUES (?,?,?,?,?,?,?, 'queued', ?, ?, ?)",
                (parent_id, session_id, task_name, cli, model, cwd, permission_mode,
                 self._utc(), self._utc(), command_summary))
            self._conn.commit()
            return int(cur.lastrowid)

    def set_status(self, agent_id: int, status: str, *, stop_reason: str | None = None,
                   pid: int | None = None, cli_session_id: str | None = None) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE agents SET status=?, stop_reason=?, updated_at=?,"
                " finished_at=COALESCE(finished_at, CASE WHEN ? IN ('terminated','error','cancelled','incomplete') THEN ? END),"
                " pid=COALESCE(?, pid), cli_session_id=COALESCE(?, cli_session_id) WHERE id=?",
                (status, stop_reason, self._utc(), status, self._utc(), pid,
                 cli_session_id, agent_id))
            self._conn.commit()

    def get_agent(self, agent_id: int) -> dict[str, Any] | None:
        row = self._conn.execute("SELECT * FROM agents WHERE id=?", (agent_id,)).fetchone()
        return dict(row) if row else None

    def agents_by_session(self, session_id: str | None) -> list[dict[str, Any]]:
        if session_id is None:
            rows = self._conn.execute("SELECT * FROM agents ORDER BY id").fetchall()
        else:
            rows = self._conn.execute("SELECT * FROM agents WHERE session_id=? ORDER BY id",
                                      (session_id,)).fetchall()
        return [dict(r) for r in rows]

    def insert_event(self, *, agent_id: int, type: str, payload: dict,
                     session_id: str) -> int | None:
        """唯一写入源。delta 不落库但保留 seq 空洞由 AUTOINCREMENT 处理——直接跳过。"""
        if type == "agent.message_delta":
            return None
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO events (session_id, agent_id, type, payload, created_at)"
                " VALUES (?,?,?,?,?)", (session_id, agent_id, type,
                                        json_dumps(payload), self._utc()))
            self._conn.commit()
            self._maybe_retain()
            return int(cur.lastrowid)

    def events_since(self, seq: int, *, session_id: str | None = None,
                     limit: int = 1000) -> list[dict[str, Any]]:
        if session_id is None:
            rows = self._conn.execute(
                "SELECT seq, session_id, agent_id, type, payload, created_at FROM events"
                " WHERE seq>? ORDER BY seq LIMIT ?", (seq, limit)).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT seq, session_id, agent_id, type, payload, created_at FROM events"
                " WHERE seq>? AND session_id=? ORDER BY seq LIMIT ?",
                (seq, session_id, limit)).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            try:
                d["payload"] = json_loads(d["payload"])
            except Exception:
                d["payload"] = {}
            out.append(d)
        return out

    def upsert_usage(self, *, agent_id: int, model: str, input_tokens: int,
                     output_tokens: int, cache_creation: int, cache_read: int,
                     cost_usd: float) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO usage (agent_id, model, input_tokens, output_tokens,"
                " cache_creation, cache_read, cost_usd, ts) VALUES (?,?,?,?,?,?,?,?)"
                " ON CONFLICT(agent_id, model) DO UPDATE SET"
                " input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens,"
                " cache_creation=excluded.cache_creation, cache_read=excluded.cache_read,"
                " cost_usd=excluded.cost_usd, ts=excluded.ts",
                (agent_id, model, input_tokens, output_tokens, cache_creation,
                 cache_read, cost_usd, self._utc()))
            self._conn.commit()

    def usage_total(self, agent_id: int) -> dict[str, int | float]:
        row = self._conn.execute(
            "SELECT COALESCE(SUM(input_tokens),0) input_tokens,"
            " COALESCE(SUM(output_tokens),0) output_tokens,"
            " COALESCE(SUM(cache_creation),0) cache_creation,"
            " COALESCE(SUM(cache_read),0) cache_read,"
            " COALESCE(SUM(cost_usd),0) cost_usd FROM usage WHERE agent_id=?", (agent_id,)).fetchone()
        return dict(row)

    def insert_message(self, *, agent_id: int, role: str, content: str) -> None:
        with self._lock:
            self._conn.execute("INSERT INTO messages (agent_id, role, content, ts)"
                               " VALUES (?,?,?,?)", (agent_id, role, content, self._utc()))
            self._conn.execute(
                "DELETE FROM messages WHERE id IN (SELECT id FROM messages WHERE agent_id=?"
                " ORDER BY id DESC LIMIT -1 OFFSET ?)", (agent_id, self.max_messages_per_agent))
            self._conn.commit()

    def messages_for(self, agent_id: int, *, page: int = 0, size: int = 100) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT id, role, content, ts FROM messages WHERE agent_id=? ORDER BY id LIMIT ? OFFSET ?",
            (agent_id, size, page * size)).fetchall()
        return [dict(r) for r in rows]

    def _maybe_retain(self) -> None:
        count = self._conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        if count > self.max_events:
            keep_seq = self._conn.execute(
                "SELECT seq FROM events ORDER BY seq DESC LIMIT 1 OFFSET ?",
                (self.max_events,)).fetchone()
            if keep_seq:
                self._conn.execute("DELETE FROM events WHERE seq < ? AND type NOT IN"
                                   " ('agent.terminated','agent.usage')", (keep_seq[0],))
        if self.retention_days > 0:
            cutoff = datetime.now(timezone.utc).timestamp() - self.retention_days * 86400
            self._conn.execute("DELETE FROM events WHERE created_at < ?",
                               (datetime.fromtimestamp(cutoff, timezone.utc).isoformat(),))
        self._conn.commit()

def json_dumps(payload: dict) -> str:
    import json
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

def json_loads(s: str) -> dict:
    import json
    return json.loads(s)
```

**Step 4: 跑测试确认通过**

**Step 5: 提交** — `feat: add sqlite storage layer with WAL and retention`

---

## Phase 2: 派发层

### Task 4: CLI 适配器基类 + claude 适配器

**Files:**
- Create: `agent_mcp/cli_adapters.py`
- Test: `tests/test_cli_adapters.py`

**Step 1: 写失败测试（用 claude 已实测格式做 fixture）**

```python
# tests/test_cli_adapters.py
import pytest
from agent_mcp.cli_adapters import get_adapter, CLAUDE_FIXTURE_EVENTS

CLAUDE_RESULT = {
    "is_error": False, "stop_reason": "end_turn", "session_id": "s-abc",
    "total_cost_usd": 0.3,
    "usage": {"input_tokens": 100, "output_tokens": 20,
              "cache_creation_input_tokens": 0, "cache_read_input_tokens": 50},
    "modelUsage": {"m1": {"inputTokens": 100, "outputTokens": 20,
                          "cacheReadInputTokens": 50, "costUSD": 0.3}},
}

def test_claude_adapter_builds_command():
    a = get_adapter("claude")
    cmd = a.build_command(prompt="hi", cwd="/tmp", model="x",
                          permission_mode="plan", max_turns=5, resume=None)
    assert cmd[0].endswith("claude") or "claude" in cmd[0]
    assert "--output-format" in cmd and "stream-json" in cmd

def test_claude_parse_stream_extracts_usage():
    a = get_adapter("claude")
    events, usage = a.parse_stream(stream_lines(a, CLAUDE_RESULT))
    assert usage["input_tokens"] == 100
    assert usage["cost_usd"] == 0.3
    assert any(e["type"] == "agent.usage" for e in events)

def test_claude_parse_dedupe_by_message_id():
    # 同一 message.id 的多个 assistant 事件只记一次 usage
    a = get_adapter("claude")
    lines = [
        {"type": "assistant", "message": {"id": "m1", "usage": {"input_tokens": 5}}},
        {"type": "assistant", "message": {"id": "m1", "usage": {"input_tokens": 5}}},
        {"type": "result", "result": CLAUDE_RESULT},
    ]
    _, usage = a.parse_stream([json.dumps(l) for l in lines])
    assert usage["input_tokens"] == 100  # result 覆盖，不重复累加

def test_unknown_cli_rejected():
    with pytest.raises(ValueError):
        get_adapter("nonexistent")
```

**Step 2: 跑测试确认失败**

**Step 3: 最小实现（基类 + claude；其余三适配器在 Task 5-7 补）**

```python
# agent_mcp/cli_adapters.py
from __future__ import annotations
import json
import re
import shutil
from pathlib import Path
from typing import Any, Callable

HOME = Path.home()

class BaseAdapter:
    cli_name = ""
    def build_command(self, *, prompt: str, cwd: str, model: str | None,
                      permission_mode: str, max_turns: int, resume: str | None) -> list[str]:
        raise NotImplementedError
    def parse_stream(self, lines: list[str]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        """返回 (规范化事件列表, 累计 usage dict)"""
        raise NotImplementedError
    def extract_session_id(self, raw: dict) -> str | None:
        return None
    def binary(self) -> str | None:
        return None

class ClaudeAdapter(BaseAdapter):
    cli_name = "claude"
    _BIN = ["claude", str(HOME / ".local/bin/claude")]
    PERMISSION_FLAGS = {
        "plan": ["--permission-mode", "plan"],
        "acceptEdits": ["--permission-mode", "acceptEdits"],
        "fullAccess": ["--dangerously-skip-permissions"],
    }
    def binary(self) -> str | None:
        for cand in self._BIN:
            found = shutil.which(cand)
            if found:
                return found
        return None
    def build_command(self, *, prompt, cwd, model=None, permission_mode="plan",
                      max_turns=8, resume=None) -> list[str]:
        cmd = [self.binary(), "-p", "--output-format", "stream-json", "--verbose",
               "--cwd", str(cwd), "--max-turns", str(max_turns)]
        cmd += self.PERMISSION_FLAGS.get(permission_mode, self.PERMISSION_FLAGS["plan"])
        if model:
            cmd += ["--model", model]
        if resume:
            cmd += ["--resume", resume]
        cmd.append(prompt)
        return cmd
    def parse_stream(self, lines) -> tuple[list[dict], dict]:
        events: list[dict] = []
        usage: dict[str, Any] = {}
        seen_ids: set[str] = set()
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(raw, dict):
                continue
            typ = raw.get("type")
            if typ == "assistant" and isinstance(raw.get("message"), dict):
                msg = raw["message"]
                mid = msg.get("id")
                if mid and mid not in seen_ids:
                    seen_ids.add(mid)
                    if isinstance(msg.get("usage"), dict):
                        u = msg["usage"]
                        usage = merge_usage(usage, {
                            "input_tokens": u.get("input_tokens", 0),
                            "output_tokens": u.get("output_tokens", 0),
                            "cache_creation": u.get("cache_creation_input_tokens", 0),
                            "cache_read": u.get("cache_read_input_tokens", 0),
                            "cost_usd": 0.0,
                        })
                events.append({"type": "agent.message", "payload": {"text": msg.get("content", "")}})
            elif typ == "result" and isinstance(raw.get("result"), dict):
                res = raw["result"]
                u = res.get("usage") or {}
                usage = merge_usage(usage, {
                    "input_tokens": u.get("input_tokens", 0),
                    "output_tokens": u.get("output_tokens", 0),
                    "cache_creation": u.get("cache_creation_input_tokens", 0),
                    "cache_read": u.get("cache_read_input_tokens", 0),
                    "cost_usd": res.get("total_cost_usd", 0.0) or 0.0,
                })
                events.append({"type": "agent.usage", "payload": dict(usage)})
                sid = res.get("session_id")
                if sid:
                    events.append({"type": "agent.terminated",
                                   "payload": {"stop_reason": res.get("stop_reason", "end_turn"),
                                               "session_id": sid}})
        return events, usage

def merge_usage(base: dict, add: dict) -> dict:
    out = dict(base)
    for k, v in add.items():
        out[k] = out.get(k, 0) + (v if isinstance(v, (int, float)) else 0)
    return out

_CLAUDE = ClaudeAdapter()
_ADAPTERS: dict[str, BaseAdapter] = {"claude": _CLAUDE}

def get_adapter(name: str) -> BaseAdapter:
    if name not in _ADAPTERS:
        raise ValueError(f"unknown target_cli: {name}")
    return _ADAPTERS[name]

def register_adapter(adapter: BaseAdapter) -> None:
    _ADAPTERS[adapter.cli_name] = adapter
```

**Step 4: 跑测试确认通过**

**Step 5: 提交** — `feat: add CLI adapter base and claude adapter with usage extraction`

---

### Task 5: grok 适配器

**Files:**
- Modify: `agent_mcp/cli_adapters.py`
- Test: `tests/test_grok_adapter.py`

**Step 1: 写失败测试（grok streaming-messages-json 格式 fixture）**

```python
# tests/test_grok_adapter.py
from agent_mcp.cli_adapters import get_adapter

GROK_MSG = {"type": "message", "message": {
    "id": "msg_1", "role": "assistant", "content": [{"type": "text", "text": "hi"}],
    "usage": {"input_tokens": 10, "output_tokens": 5, "cache_creation_input_tokens": 0,
              "cache_read_input_tokens": 2},
}}

def test_grok_command_uses_single_and_streaming():
    a = get_adapter("grok")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model="ocx-jbb-grok-4-5",
                          permission_mode="fullAccess", max_turns=10, resume=None)
    assert "--single" in cmd
    assert "--output-format" in cmd
    assert "streaming-messages-json" in cmd or "streaming-json" in cmd
    assert "--permission-mode" in cmd and "bypassPermissions" in cmd

def test_grok_parse_messages_format():
    a = get_adapter("grok")
    events, usage = a.parse_stream([json.dumps(GROK_MSG)])
    assert usage["input_tokens"] == 10
    assert any(e["type"] == "agent.message" for e in events)
```

**Step 2: 跑测试确认失败**

**Step 3: 实现 GrokAdapter**（命令：`grok --cwd <dir> --output-format streaming-messages-json --permission-mode <mode> --max-turns <n> [--model m] [--always-approve] [--no-subagents] --single <prompt>`；解析：Anthropic Messages 事件 `message_start/message_delta/message_stop` 与顶层 `{"type":"message",...}`；usage 从 message.usage 四字段；session 从 `message_start` 的 `message.id` 或顶层 session_id）

**Step 4: 跑测试确认通过**

**Step 5: 提交** — `feat: add grok CLI adapter (streaming-messages-json)`

---

### Task 6: opencode 适配器

**Files:**
- Modify: `agent_mcp/cli_adapters.py`
- Test: `tests/test_opencode_adapter.py`

**Step 1: 写失败测试**

```python
# tests/test_opencode_adapter.py
from agent_mcp.cli_adapters import get_adapter

def test_opencode_command():
    a = get_adapter("opencode")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model=None,
                          permission_mode="acceptEdits", max_turns=8, resume=None)
    assert cmd[0].endswith("opencode")
    assert "run" in cmd
    assert "--format" in cmd and "json" in cmd

def test_opencode_parse_events():
    a = get_adapter("opencode")
    lines = [
        json.dumps({"type": "message", "message": {"role": "assistant",
                    "content": [{"type": "text", "text": "working"}]}}),
        json.dumps({"type": "tool", "tool": {"name": "bash", "input": {"command": "ls"}}}),
        json.dumps({"type": "done", "message": {"role": "assistant",
                    "content": [{"type": "text", "text": "ok"}]},
                    "usage": {"inputTokens": 7, "outputTokens": 3}}),
    ]
    events, usage = a.parse_stream(lines)
    assert any(e["type"] == "agent.tool_use" for e in events)
    assert usage["input_tokens"] == 7
```

**Step 2: 跑测试确认失败**

**Step 3: 实现 OpencodeAdapter**（命令：`opencode run <prompt> --format json [--model m] [-m plan] [-y]`；解析：message/tool/done 事件，usage 归一化 inputTokens→input_tokens，session 从事件中的 sessionID）

**Step 4: 跑测试确认通过**

**Step 5: 提交** — `feat: add opencode CLI adapter`

---

### Task 7: omp 适配器

**Files:**
- Modify: `agent_mcp/cli_adapters.py`
- Test: `tests/test_omp_adapter.py`

**Step 1: 写失败测试（按 Task 0 实测结果；未实测前用占位 fixture）**

```python
# tests/test_omp_adapter.py
from agent_mcp.cli_adapters import get_adapter

def test_omp_adapter_registered():
    a = get_adapter("omp")
    assert a.cli_name == "omp"

def test_omp_command_headless():
    a = get_adapter("omp")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=8, resume=None)
    assert cmd and isinstance(cmd, list)
```

**Step 2: 跑测试确认失败**

**Step 3: 实现 OmpAdapter**（依据 Task 0 实测：`omp` headless 驱动方式；事件流格式；usage；能力未知项返回降级——parse_stream 至少能提取最终输出，session/usage 尽力而为）

**Step 4: 跑测试确认通过**

**Step 5: 提交** — `feat: add omp CLI adapter`

---

### Task 8: 派发执行器（并发槽位 · 进程管理 · interrupt · 孤儿回收）

**Files:**
- Create: `agent_mcp/dispatch.py`
- Test: `tests/test_dispatch.py`

**Step 1: 写失败测试**

```python
# tests/test_dispatch.py
from agent_mcp.dispatch import SlotScheduler, build_worker_command

def test_slot_scheduler_fifo():
    s = SlotScheduler(max_concurrent=2)
    assert s.acquire("a") and s.acquire("b")
    assert not s.acquire("c")  # 满
    s.release("a")
    assert s.acquire("c")

def test_worker_command_includes_state_paths(tmp_path):
    cmd = build_worker_command(state_path=tmp_path / "s.json",
                               out_path=tmp_path / "o.log", err_path=tmp_path / "e.log",
                               cwd=str(tmp_path), cli_command=["claude", "-p", "hi"])
    assert cmd[0].endswith("dispatch_worker.py") or "agent_daemon" in cmd[0]

def test_process_tree_terminate_smoke():
    # psutil 进程树终止的轻量冒烟：spawn sleep 子进程再杀
    import subprocess, time, psutil
    p = subprocess.Popen(["sh", "-c", "sleep 30 & sleep 30"])
    time.sleep(0.5)
    tree = psutil.Process(p.pid).children(recursive=True)
    assert len(tree) >= 1
    # 实现 terminate_process_tree 后断言所有 pid 退出
```

**Step 2: 跑测试确认失败**

**Step 3: 最小实现**

```python
# agent_mcp/dispatch.py
from __future__ import annotations
import json
import os
import signal
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

import psutil

class SlotScheduler:
    """FIFO 并发槽位（Codex V2 AgentExecutionLimiter 的本地版）。"""
    def __init__(self, max_concurrent: int = 4):
        self.max = max_concurrent
        self._active: set[str] = set()
        self._queue: list[str] = []
        self._lock = threading.Lock()

    def acquire(self, agent_key: str) -> bool:
        with self._lock:
            if agent_key in self._active or agent_key in self._queue:
                return False
            if len(self._active) < self.max:
                self._active.add(agent_key)
                return True
            self._queue.append(agent_key)
            return False

    def release(self, agent_key: str) -> str | None:
        """释放槽位，返回可补位的排队 key（若有）。"""
        with self._lock:
            self._active.discard(agent_key)
            while self._queue:
                nxt = self._queue.pop(0)
                if nxt not in self._active:
                    self._active.add(nxt)
                    return nxt
            return None

    def queued(self) -> list[str]:
        with self._lock:
            return list(self._queue)


def terminate_process_tree(pid: int, *, timeout: float = 5.0) -> bool:
    """跨平台进程树终止。macOS 用 SIGTERM→SIGKILL；Windows TerminateProcess。"""
    if pid <= 0:
        return False
    try:
        proc = psutil.Process(pid)
    except psutil.NoSuchProcess:
        return True
    try:
        children = proc.children(recursive=True)
        for child in children:
            try:
                child.terminate()
            except psutil.NoSuchProcess:
                pass
        proc.terminate()
        gone, alive = psutil.wait_procs([proc] + children, timeout=timeout)
        for still in alive:
            try:
                still.kill()
            except psutil.NoSuchProcess:
                pass
        return True
    except (psutil.Error, OSError):
        return False


def is_pid_running(pid: int | None) -> bool:
    if not pid or pid <= 0:
        return False
    try:
        p = psutil.Process(pid)
        return p.is_running() and p.status() != psutil.STATUS_ZOMBIE
    except psutil.NoSuchProcess:
        return False


def build_worker_command(*, state_path: Path, out_path: Path, err_path: Path,
                         cwd: str, cli_command: list[str]) -> list[str]:
    """分离 worker：本脚本 --dispatch-worker 模式（与现有 grok MCP 同构）。"""
    worker = Path(__file__).resolve().parent.parent / "dispatch_worker.py"
    return [sys.executable, str(worker), str(state_path), str(out_path),
            str(err_path), cwd, json.dumps(cli_command, ensure_ascii=False)]


def spawn_detached(command: list[str], *, env: dict[str, str] | None = None) -> subprocess.Popen:
    """跨平台分离启动（daemon / worker 用）。"""
    kwargs: dict[str, Any] = dict(env=env, stdin=subprocess.DEVNULL,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if os.name == "nt":
        kwargs["creationflags"] = (subprocess.CREATE_NEW_PROCESS_GROUP
                                   | getattr(subprocess, "DETACHED_PROCESS", 0))
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen(command, **kwargs)
```

**Step 4: 跑测试确认通过**

**Step 5: 提交** — `feat: add dispatch executor with slot scheduler and process tree management`

---

## Phase 3: daemon + MCP

### Task 9: daemon HTTP + SSE 服务器

**Files:**
- Create: `agent_mcp/daemon_http.py`
- Create: `agent_mcp/daemon_main.py`（入口：初始化 DB/调度器/服务器，写锁文件 + token）
- Test: `tests/test_daemon_http.py`

**Step 1: 写失败测试**

```python
# tests/test_daemon_http.py
import json, threading
from agent_mcp.daemon_http import DaemonHTTPServer, EventBroadcaster

def test_broadcaster_heartbeat_and_limit():
    b = EventBroadcaster(max_clients=2)
    c1, c2 = b.connect(), b.connect()
    assert not b.connect()  # 超限
    b.close(c1)
    assert b.connect() is not None

def test_broadcast_delta_not_persisted():
    b = EventBroadcaster(max_clients=2)
    c = b.connect()
    events = []
    b.publish({"type": "agent.message", "agent_id": 1}, seq=1)
    assert c["buffer"]  # 有内容

def test_http_health_and_host_check(tmp_path):
    # 起一个真 server 打 /health；Host 头错误应 400
    srv = DaemonHTTPServer(("127.0.0.1", 0), tmp_path, token="t", db=None, dispatcher=None)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    import urllib.request
    resp = urllib.request.urlopen(f"http://127.0.0.1:{srv.server_address[1]}/health")
    assert resp.status == 200
    srv.shutdown()
```

**Step 2: 跑测试确认失败**

**Step 3: 最小实现**

```python
# agent_mcp/daemon_http.py
from __future__ import annotations
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ALLOWED_HOSTS = {"127.0.0.1", "localhost"}
MAX_SSE_CLIENTS = 32
HEARTBEAT_SECONDS = 15.0


class EventBroadcaster:
    """SSE 统一广播：事件循环单写，非阻塞写，写失败断开，统一心跳。"""
    def __init__(self, max_clients: int = MAX_SSE_CLIENTS):
        self._clients: dict[int, dict[str, Any]] = {}
        self._next = 0
        self._lock = threading.Lock()

    def connect(self) -> dict[str, Any] | None:
        with self._lock:
            if len(self._clients) >= self.max:
                return None
            self._next += 1
            client = {"id": self._next, "buffer": [], "closed": False}
            self._clients[self._next] = client
            return client
    # （max_clients 经 __init__ 存 self.max）

    def close(self, client: dict[str, Any]) -> None:
        with self._lock:
            client["closed"] = True
            self._clients.pop(client["id"], None)

    def publish(self, event: dict[str, Any], *, seq: int) -> None:
        payload = f"id: {seq}\nevent: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
        with self._lock:
            clients = list(self._clients.values())
        for client in clients:
            if client["closed"]:
                continue
            try:
                client["buffer"].append(payload)
            except Exception:
                pass

    def heartbeat_all(self) -> None:
        with self._lock:
            clients = list(self._clients.values())
        for client in clients:
            if not client["closed"]:
                client["buffer"].append(": ping\n\n")


class DaemonHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, addr, web_root: Path, *, token: str, db, dispatcher, broadcaster=None):
        self.web_root = Path(web_root)
        self.token = token
        self.db = db
        self.dispatcher = dispatcher
        self.broadcaster = broadcaster or EventBroadcaster()
        super().__init__(addr, Handler)
        self.server_name = "agent-mcp-daemon"


class Handler(BaseHTTPRequestHandler):
    server: DaemonHTTPServer  # type: ignore

    def log_message(self, fmt, *args):  # 静默访问日志
        pass

    def _check_host(self) -> bool:
        host = (self.headers.get("Host") or "").split(":")[0]
        if host in ALLOWED_HOSTS:
            return True
        self.send_error(400, "bad host")
        return False

    def _check_token(self) -> bool:
        if self.headers.get("X-Auth-Token") == self.server.token:
            return True
        self.send_error(401, "unauthorized")
        return False

    def do_GET(self):
        if not self._check_host():
            return
        path = self.path.split("?")[0]
        if path == "/health":
            self._send_json(200, {"ok": True, "version": 1})
        elif path == "/events":
            self._stream_events()
        elif path == "/" or path == "/index.html":
            self._send_file("index.html")
        elif path.startswith("/static/"):
            self._send_file(path[len("/static/"):])
        else:
            self.send_error(404)

    def do_POST(self):
        if not self._check_host():
            return
        if not self._check_token():
            return
        path = self.path.split("?")[0]
        body = self._read_json()
        if path == "/api/agents/spawn":
            self._send_json(200, self.server.dispatcher.spawn(body))
        elif path == "/api/agents/send_message":
            self._send_json(200, self.server.dispatcher.send_message(body))
        elif path == "/api/agents/followup":
            self._send_json(200, self.server.dispatcher.followup(body))
        elif path == "/api/agents/wait":
            self._send_json(200, self.server.dispatcher.wait(body))
        elif path == "/api/agents/interrupt":
            self._send_json(200, self.server.dispatcher.interrupt(body))
        elif path == "/api/agents/list":
            self._send_json(200, self.server.dispatcher.list_agents(body))
        elif path == "/api/agents/activity":
            self._send_json(200, self.server.dispatcher.activity(body))
        elif path == "/api/usage":
            self._send_json(200, self.server.dispatcher.usage(body))
        else:
            self.send_error(404)

    def _stream_events(self):
        client = self.server.broadcaster.connect()
        if client is None:
            self.send_error(503, "too many SSE clients")
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            while not client["closed"]:
                buf = client["buffer"]
                if buf:
                    chunk = "".join(buf)
                    del buf[:]
                    try:
                        self.wfile.write(chunk.encode("utf-8"))
                        self.wfile.flush()
                    except (BrokenPipeError, OSError):
                        break
                else:
                    time.sleep(0.1)
        finally:
            self.server.broadcaster.close(client)

    def _send_json(self, code: int, payload: Any):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_file(self, name: str):
        path = self.server.web_root / name
        if not path.is_file():
            self.send_error(404)
            return
        data = path.read_bytes()
        self.send_response(200)
        ctype = "text/html; charset=utf-8" if name.endswith(".html") else "application/octet-stream"
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return {}
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return {}
```

**Step 4: 跑测试确认通过**；手动冒烟：`curl http://127.0.0.1:PORT/health` 200、错误 Host 400、无 token POST 401

**Step 5: 提交** — `feat: add daemon HTTP server with SSE broadcasting and auth`

---

### Task 10: MCP 薄层（8 工具 · 原子拉起 · host 识别 · 会话隔离）

**Files:**
- Create: `mcp_server.py`（stdio server，零依赖，复用现有 grok_cli_mcp.py 的 stdio/rpc 骨架）
- Test: `tests/test_mcp_server.py`

**Step 1: 写失败测试（MCP 协议级）**

```python
# tests/test_mcp_server.py
import json, subprocess, sys, threading, time
from agent_mcp.daemon_http import DaemonHTTPServer
from agent_mcp.daemon_main import DaemonContext

def test_initialize_returns_server_info():
    # 直接调用 handle() 的 JSON-RPC 层（stdin/stdout 子进程测在集成阶段）
    from mcp_server import handle_line
    out = []
    handle_line({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                 "params": {"clientInfo": {"name": "codex"}}}, emit=out.append)
    msg = json.loads(out[0])
    assert msg["result"]["serverInfo"]["name"] == "agent-mcp"

def test_tools_list_has_eight_tools():
    from mcp_server import TOOLS
    names = [t["name"] for t in TOOLS]
    assert names == ["spawn_agent", "send_message", "followup_task", "wait_agent",
                     "interrupt_agent", "list_agents", "get_agent_activity", "get_token_usage"]

def test_clientinfo_host_extracted():
    from mcp_server import host_from_client_info
    assert host_from_client_info({"name": "codex"}) == "codex"
    assert host_from_client_info({"name": "claude-ai"}) == "claude"
    assert host_from_client_info({"name": "omp"}) == "omp"
```

**Step 2: 跑测试确认失败**

**Step 3: 最小实现**

```python
# mcp_server.py（核心结构；stdlib 零依赖）
from __future__ import annotations
import json, os, sys, time, urllib.request, uuid
from pathlib import Path

SERVER_VERSION = "2.0.0"
DAEMON_HOST = "127.0.0.1"
DAEMON_PORT = int(os.environ.get("AGENT_MCP_PORT", "8765"))
STATE_DIR = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")) / "agent-mcp"
DAEMON_LOCK = STATE_DIR / "daemon.lock"
DAEMON_JSON = STATE_DIR / "daemon.json"
DAEMON_SCRIPT = Path(__file__).resolve().parent / "agent_mcp" / "daemon_main.py"

TOOLS = [  # 8 工具 schema（完整描述见设计文档 §3）
    {"name": "spawn_agent", "description": "...", "inputSchema": {...}},
    # ... send_message / followup_task / wait_agent / interrupt_agent /
    #     list_agents / get_agent_activity / get_token_usage
]

def host_from_client_info(info: dict | None) -> str:
    name = (info or {}).get("name", "")
    lowered = name.lower()
    if "codex" in lowered: return "codex"
    if "claude" in lowered: return "claude"
    if "omp" in lowered: return "omp"
    return "unknown"

def ensure_daemon() -> tuple[str, str, str]:
    """原子拉起：探测 /health → spawn → 轮询；返回 (base_url, token, host)。"""
    import socket
    base = f"http://{DAEMON_HOST}:{DAEMON_PORT}"
    token = ""
    if DAEMON_JSON.is_file():
        try:
            token = json.loads(DAEMON_JSON.read_text()).get("token", "")
        except Exception:
            token = ""
    # 1) 探测
    for attempt in range(10):
        try:
            with urllib.request.urlopen(base + "/health", timeout=1) as resp:
                if resp.status == 200:
                    return base, token, ""  # 已存活
        except Exception:
            pass
        if attempt == 0:
            # 2) spawn（锁文件 pid 存活校验）
            stale = True
            if DAEMON_LOCK.is_file():
                try:
                    lock = json.loads(DAEMON_LOCK.read_text())
                    stale = not _pid_alive(lock.get("pid"))
                except Exception:
                    stale = True
            if stale:
                DAEMON_LOCK.write_text(json.dumps({"pid": os.getpid(),
                                                   "ts": time.time()}))
                env = dict(os.environ)
                if not token:
                    token = uuid.uuid4().hex
                (STATE_DIR / "daemon.json").write_text(json.dumps({"token": token}))
                _spawn_detached([sys.executable, str(DAEMON_SCRIPT)])
        time.sleep(0.5)
    raise RuntimeError("daemon failed to start within 5s")
```

**Step 4: 跑测试确认通过**；集成验证：起 daemon → `python3 -c` 调用 ensure_daemon → /health 200

**Step 5: 提交** — `feat: add MCP thin server with 8 tools and atomic daemon launch`

---

## Phase 4: 前端

### Task 11: 单文件网页（Claude UI 风格知识导图）

**Files:**
- Create: `web/index.html`（自包含，无外部依赖）
- Create: `tests/test_web.py`（无头验证：HTML 包含关键元素 + SSE 端点连接）

**Step 1: 写失败测试**

```python
# tests/test_web.py
def test_web_contains_core_elements():
    html = (PROJECT_ROOT / "web" / "index.html").read_text(encoding="utf-8")
    assert "EventSource" in html          # SSE
    assert "knowledge" in html or "svg" in html  # 导图渲染
    assert "token" in html.lower()
    assert "fetch" in html or "EventSource" in html
```

**Step 2: 跑测试确认失败** — FileNotFoundError

**Step 3: 实现单文件前端**（核心结构）

```html
<!-- web/index.html：Claude UI 风格 · SSE 实时 · 知识导图（SVG 树）+ 详情面板 + token 统计 -->
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Agent MCP</title>
<style>/* 米白背景 #FAF9F5 · 杏色 accent #C15F3C · 衬线标题 Georgia · 圆角卡片（同 design-preview.html 设计语言）*/</style>
</head>
<body>
  <header><!-- 顶栏：标题 + 会话切换 + 统计（进行中/排队/完成/失败 · 总 token · 成本）--></header>
  <main>
    <div id="map"><!-- SVG 知识导图：/root → 分支 agent 节点 → 汇合 --></div>
    <aside id="detail"><!-- 节点详情面板：活动/tool_use 流/消息分页/token 曲线 --></aside>
  </main>
<script>
// SSE: new EventSource('/events?last_seq='+localStorage.lastSeq)
// 事件分发: agent.spawned→加节点; agent.running/idle/terminated→更新状态色;
//           agent.message→详情面板追加(rAF 合并); agent.message_delta→打字机;
//           agent.usage→统计累加(按模型拆分); 断线重连→last_seq + dedupe
// 导图布局: 手写 DFS 树布局（节点宽度 + 子分支 y 坐标分配），SVG path 连线，
//           节点点击→详情面板；host/CLI 颜色区分
</script>
</body></html>
```

**Step 4: 跑测试确认通过**；浏览器冒烟：起 daemon → 打开 `http://127.0.0.1:8765/` → 空状态渲染 + SSE 连接无报错

**Step 5: 提交** — `feat: add single-file web UI with knowledge map and live stats`

---

## Phase 5: skill + 部署

### Task 12: 配套 skill

**Files:**
- Create: `skill/SKILL.md`（codex `.agents/skills/agent-mcp/SKILL.md` 同构）
- Create: `skill/agents/*.md`（内置 agent 预设提示词，从 `~/.claude/agents/` 精选 8-10 个：planner/architect/code-reviewer/security-reviewer/tdd-guide/build-error-resolver/e2e-runner/refactor-cleaner/doc-updater/code-explorer）
- Test: `tests/test_skill.py`

**Step 1: 写失败测试**

```python
# tests/test_skill.py
def test_skill_docs_exist():
    skill = (PROJECT_ROOT / "skill" / "SKILL.md").read_text(encoding="utf-8")
    for tool in ("spawn_agent", "followup_task", "wait_agent", "list_agents"):
        assert tool in skill
    assert "六步" in skill or "工作流" in skill
    assert "target_cli" in skill

def test_builtin_agents_exist():
    agents = [p.stem for p in (PROJECT_ROOT / "skill" / "agents").glob("*.md")]
    for name in ("planner", "code-reviewer", "security-reviewer", "tdd-guide",
                 "build-error-resolver"):
        assert name in agents
```

**Step 2: 跑测试确认失败**

**Step 3: 实现**：SKILL.md 含——六步工作流（拆解→规划审查→并行派发→监控→汇合→审查迭代）；8 工具参数速查 + 调用示例；错误恢复路径（超时→resume/重派、认证→检查 CLI 登录与 opencodex 代理、权限拒绝→改 permission_mode）；去模型化声明（不指定 CLI/模型，由主 agent 按指南决策）。`agents/*.md` 为提示词模板（name/description/developer_instructions 三字段 frontmatter）。

**Step 4: 跑测试确认通过**

**Step 5: 提交** — `feat: add companion skill with six-step workflow and builtin agents`

---

### Task 13: 安装 / 迁移脚本

**Files:**
- Create: `install.py`（三主载体注册 + 旧 grok-cli 迁移 + 回滚）
- Test: `tests/test_install.py`

**Step 1: 写失败测试**

```python
# tests/test_install.py
from install import codex_registration_toml, claude_registration_json, omp_registration

def test_codex_toml_snippet():
    toml = codex_registration_toml(script_path="/tmp/mcp_server.py")
    assert "[mcp_servers.agent-mcp]" in toml
    assert "mcp_server.py" in toml

def test_claude_json_snippet():
    obj = claude_registration_json(script_path="/tmp/mcp_server.py")
    assert obj["mcpServers"]["agent-mcp"]["command"].endswith("python3")
    assert "mcp_server.py" in obj["mcpServers"]["agent-mcp"]["args"][0]

def test_omp_registration_returns_notes():
    notes = omp_registration(script_path="/tmp/mcp_server.py")
    assert isinstance(notes, str) and len(notes) > 20
```

**Step 2: 跑测试确认失败**

**Step 3: 实现**：生成三主载体注册片段（codex TOML / claude JSON / omp 按实测格式），`--install` 写配置（先备份）、`--rollback` 恢复备份、旧 `[mcp_servers.grok-cli]` 检测与废弃提示；工具名映射表（旧 9 → 新 8）输出。

**Step 4: 跑测试确认通过**；dry-run 冒烟：`python3 install.py --dry-run` 打印三端注册

**Step 5: 提交** — `feat: add install and migration script for three hosts`

---

## Phase 6: 集成与验收

### Task 14: 集成冒烟 + 验收核对

**Files:**
- Create: `tests/test_integration.py`（标 `@pytest.mark.integration`，可用 `--skip-cli` 跳过真实 CLI）
- Create: `docs/acceptance.md`（验收核对清单）

**Step 1: 集成冒烟测试**

```python
# tests/test_integration.py
@pytest.mark.integration
def test_spawn_wait_claude(tmp_path):
    # 起 daemon → 调 spawn_agent(claude, "回复 OK") → wait_agent → 断言 terminated/end_turn
    ...

@pytest.mark.integration
def test_sse_stream_receives_events(tmp_path):
    # 开 SSE → spawn → 收到 agent.spawned/running/terminated
    ...

@pytest.mark.integration
def test_mcp_roundtrip_via_stdio(tmp_path):
    # 子进程跑 mcp_server.py，JSON-RPC 握手 + spawn + wait
    ...
```

**Step 2: 跑测试确认通过**（真实 CLI 慢时可只跑 claude 一条）

**Step 3: 验收核对**（`docs/acceptance.md` 逐项打勾）：

- [ ] 任务池四 CLI 派发全通（claude/grok/opencode/omp 各一条真实任务）
- [ ] 三主载体注册生效（codex config.toml / claude .mcp.json / omp 配置）
- [ ] 网页：实时活动、任务数、token 曲线、导图展开、会话切换
- [ ] skill 三端分发可加载，六步工作流可执行
- [ ] token 与各 CLI 对账（claude result.usage / grok usage / opencode 事件）
- [ ] daemon 常驻 <100MB、页面响应 <1s
- [ ] 中断、超时、daemon 重启、多会话并发回归
- [ ] Win/Mac 冒烟（进程树终止、拉起、对账）——CI 或手动

**Step 4: 提交**

```bash
git add tests/test_integration.py docs/acceptance.md
git commit -m "test: add integration smoke tests and acceptance checklist"
```

---

## 提交顺序总览

1. `docs: record four CLI capability matrix findings`
2. `feat: add event schema with normalized event types`
3. `feat: add agent state machine with exit classification`
4. `feat: add sqlite storage layer with WAL and retention`
5. `feat: add CLI adapter base and claude adapter with usage extraction`
6. `feat: add grok CLI adapter (streaming-messages-json)`
7. `feat: add opencode CLI adapter`
8. `feat: add omp CLI adapter`
9. `feat: add dispatch executor with slot scheduler and process tree management`
10. `feat: add daemon HTTP server with SSE broadcasting and auth`
11. `feat: add MCP thin server with 8 tools and atomic daemon launch`
12. `feat: add single-file web UI with knowledge map and live stats`
13. `feat: add companion skill with six-step workflow and builtin agents`
14. `feat: add install and migration script for three hosts`
15. `test: add integration smoke tests and acceptance checklist`

每个 task 内部有 TDD 五步（写测试 → 确认失败 → 最小实现 → 确认通过 → 提交）。依赖顺序：Task 0 → 1→2→3（可并行 2/3）→ 4→5→6→7 → 8 → 9 → 10 → 11 → 12 → 13 → 14。
