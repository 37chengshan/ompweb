"""内置策略：预算 / 审批 / 工具限权（YAML 配置目标，JSON 亦可）。

三个内置策略工厂，注册到 PolicyEngine：
- budget_policy: 按 usage_delta / spawn 成本累计，超 limit 拒绝
- approval_policy: pre_spawn 时检查 prompt 是否命中 allow 前缀；未命中且需审批 → ASK
- tool_limit_policy: 限制编排子任务数 / 并行度 / spawn 频率
"""
from __future__ import annotations

import time
from typing import Any

from agent_mcp.policies import PolicyEvent, PolicyResult


def budget_policy_factory(limit_usd: float = 10.0) -> Any:
    """成本预算策略：spawn 前估算 + usage_delta 精确累计，超限拒绝。"""

    def policy(ev: PolicyEvent, state: dict[str, Any]) -> PolicyResult:
        if ev.type == "usage_delta":
            cost = float(ev.data.get("cost", 0.0) or 0.0)
            state["budget_usd"] = float(state.get("budget_usd", 0.0)) + cost
            if float(state["budget_usd"]) > limit_usd:
                ev.data["reason"] = (f"预算超限: {state['budget_usd']:.2f} > "
                                     f"{limit_usd:.2f} USD")
                return PolicyResult.DENY
            return PolicyResult.ALLOW
        if ev.type == "pre_spawn":
            estimated = float(ev.data.get("estimated_cost", 0.0) or 0.0)
            if float(state.get("budget_usd", 0.0)) + estimated > limit_usd:
                ev.data["reason"] = (f"预算将超限: 已花 {state.get('budget_usd', 0.0):.2f}"
                                     f" + 预计 {estimated:.2f} > {limit_usd:.2f} USD")
                return PolicyResult.DENY
            return PolicyResult.ALLOW
        return PolicyResult.ALLOW

    return policy


def approval_policy_factory(allow_prefixes: list[str] | None = None) -> Any:
    """审批策略：prompt 命中 allow 前缀直接放行；否则需要审批（ASK）。"""
    prefixes = tuple(allow_prefixes or [])

    def policy(ev: PolicyEvent, state: dict[str, Any]) -> PolicyResult:
        if ev.type != "pre_spawn":
            return PolicyResult.ALLOW
        prompt = str(ev.data.get("prompt") or "")
        cli = str(ev.data.get("cli") or "")
        if any(prompt.startswith(p) for p in prefixes):
            return PolicyResult.ALLOW
        # 显式 allow 名单里的 CLI 也放行（如只读类 CLI）
        allowed_clis = tuple(ev.data.get("allowed_clis") or ())
        if allowed_clis and cli in allowed_clis:
            return PolicyResult.ALLOW
        if not prefixes and not allowed_clis:
            # 未配置白名单：默认放行（策略未启用）
            return PolicyResult.ALLOW
        ev.data["reason"] = f"任务需审批（cli={cli}，prompt 前缀未命中白名单）"
        return PolicyResult.ASK

    return policy


def tool_limit_policy_factory(max_subtasks: int = 8, max_parallel: int = 4,
                              min_spawn_interval: float = 0.0) -> Any:
    """工具限权策略：编排子任务数 / 并行度上限 / spawn 最小间隔。"""
    last_spawn: list[float] = [0.0]

    def policy(ev: PolicyEvent, state: dict[str, Any]) -> PolicyResult:
        if ev.type == "pre_orchestrate":
            n = int(ev.data.get("task_count", 0) or 0)
            if n > max_subtasks:
                ev.data["reason"] = f"编排子任务数 {n} > 上限 {max_subtasks}"
                return PolicyResult.DENY
            parallel = int(ev.data.get("max_workers", 0) or 0)
            if parallel > max_parallel:
                ev.data["reason"] = f"并行度 {parallel} > 上限 {max_parallel}"
                return PolicyResult.DENY
            return PolicyResult.ALLOW
        if ev.type == "pre_spawn" and min_spawn_interval > 0:
            now = time.monotonic()
            if now - last_spawn[0] < min_spawn_interval:
                ev.data["reason"] = "spawn 过于频繁（最小间隔未到）"
                return PolicyResult.DENY
            last_spawn[0] = now
            return PolicyResult.ALLOW
        return PolicyResult.ALLOW

    return policy
