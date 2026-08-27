"""策略治理引擎：声明式策略链 + 持久化状态（零依赖 JSON，与薄层同风格）。

enforcement 点（由调用方接线）：
- pre_spawn：spawn_agent / orchestrate_task 入口前
- pre_steer：steer_agent 入口前
- pre_tool：任意工具调用前（可选）

策略按注册顺序评估；DENY 短路返回；state 支持预算累计与审计日志。
"""
from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Any, Callable

PolicyFn = Callable[["PolicyEvent", dict[str, Any]], "PolicyResult"]


class PolicyResult(str, Enum):
    ALLOW = "allow"
    DENY = "deny"
    ASK = "ask"


@dataclass
class PolicyEvent:
    type: str                 # pre_spawn / pre_steer / usage_delta
    agent_id: str = ""
    data: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class PolicyDecision:
    name: str
    result: str
    reason: str = ""
    ts: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class PolicyEngine:
    """策略链引擎。state 为跨事件可变状态（预算累计、计数、审计日志）。"""

    def __init__(self, state_path: str | Path | None = None,
                 max_log: int = 200) -> None:
        self.policies: dict[str, PolicyFn] = {}
        self._order: list[str] = []
        self._lock = threading.Lock()
        self.max_log = max_log
        self.state_path = Path(state_path) if state_path else None
        self._dirty = False  # A5：状态有变未落盘标记（热路径去同步写盘）
        self.state: dict[str, Any] = {
            "budget_usd": 0.0, "spawns": 0, "tool_calls": 0, "log": [],
        }
        if self.state_path and self.state_path.exists():
            self._load()

    # -- 状态持久化 -----------------------------------------------------

    def _load(self) -> None:
        try:
            raw = json.loads(self.state_path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                merged = {**self.state, **raw}
                # L2：类型防护（log/spawns/budget 字段可能被外部写坏）
                log = raw.get("log")
                merged["log"] = (log if isinstance(log, list) else [])[-self.max_log:]
                for key in ("spawns", "tool_calls"):
                    try:
                        merged[key] = int(merged.get(key, 0))
                    except (TypeError, ValueError):
                        merged[key] = 0
                try:
                    merged["budget_usd"] = float(merged.get("budget_usd", 0.0))
                except (TypeError, ValueError):
                    merged["budget_usd"] = 0.0
                self.state = merged
        except (OSError, json.JSONDecodeError):
            pass  # 状态文件损坏按空状态

    def save(self) -> None:
        if not self.state_path:
            return
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, ensure_ascii=False,
                                  separators=(",", ":")), encoding="utf-8")
        os.replace(tmp, self.state_path)
        with self._lock:
            self._dirty = False

    def save_if_dirty(self) -> bool:
        """A5: 仅当 evaluate/_log 产生过状态变更时才写盘；返回是否实际写入。
        供后台周期调用（心跳），把策略状态持久化从事件热路径移出。"""
        with self._lock:
            dirty = self._dirty
        if dirty:
            self.save()
        return dirty

    # -- 策略注册 -------------------------------------------------------

    def register(self, name: str, fn: PolicyFn) -> None:
        if name in self.policies:
            raise ValueError(f"策略已存在: {name}")
        self.policies[name] = fn
        self._order.append(name)

    def unregister(self, name: str) -> None:
        if name not in self.policies:
            raise ValueError(f"策略不存在: {name}")
        del self.policies[name]
        self._order.remove(name)

    def list_policies(self) -> list[dict[str, Any]]:
        return [{"name": n, "enabled": True} for n in self._order]

    # -- 评估 -----------------------------------------------------------

    def evaluate(self, ev: PolicyEvent) -> PolicyDecision:
        with self._lock:
            self.state["tool_calls"] = self.state.get("tool_calls", 0) + 1
            for name in self._order:
                fn = self.policies[name]
                try:
                    result = fn(ev, self.state)
                except Exception as exc:  # noqa: BLE001 - 策略异常按 DENY 安全失败
                    decision = PolicyDecision(name, PolicyResult.DENY.value,
                                              f"策略异常: {exc}")
                    self._log(decision, ev)
                    return decision
                if result is PolicyResult.ASK:
                    decision = PolicyDecision(name, PolicyResult.ASK.value, "需人工审批")
                    self._log(decision, ev)
                    return decision
                if result is PolicyResult.DENY:
                    decision = PolicyDecision(name, PolicyResult.DENY.value,
                                              str(ev.data.get("reason") or "策略拒绝"))
                    self._log(decision, ev)
                    return decision
            decision = PolicyDecision("__default__", PolicyResult.ALLOW.value)
            self._log(decision, ev)
            return decision

    def _log(self, decision: PolicyDecision, ev: PolicyEvent) -> None:
        entry = {**decision.to_dict(), "event_type": ev.type}
        log = self.state.setdefault("log", [])
        log.append(entry)
        if len(log) > self.max_log:
            del log[: len(log) - self.max_log]
        self._dirty = True  # A5：标记待落盘，由 save_if_dirty 周期刷写

    # -- 状态查询 -------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "budget_usd": round(float(self.state.get("budget_usd", 0.0)), 4),
                "spawns": int(self.state.get("spawns", 0)),
                "tool_calls": int(self.state.get("tool_calls", 0)),
                "policies": self.list_policies(),
                "log": list(self.state.get("log", [])),
            }
