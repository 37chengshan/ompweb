"""PolicyEngine + 内置策略测试（纯本地，无 daemon/CLI 依赖）。"""
import pytest

from agent_mcp.policies import PolicyEngine, PolicyEvent, PolicyResult
from agent_mcp.policies.builtin import (
    approval_policy_factory, budget_policy_factory, tool_limit_policy_factory,
)


def make_engine(state_file, *fns) -> PolicyEngine:
    eng = PolicyEngine(state_path=state_file)
    for name, fn in fns:
        eng.register(name, fn)
    return eng


# -- 预算策略 ------------------------------------------------------------

def test_budget_usage_delta_accumulates(tmp_path):
    eng = make_engine(tmp_path, ("budget", budget_policy_factory(limit_usd=5.0)))
    assert eng.evaluate(PolicyEvent("usage_delta", data={"cost": 2.0})).result == "allow"
    assert eng.evaluate(PolicyEvent("usage_delta", data={"cost": 2.0})).result == "allow"
    # 累计 4.0 < 5.0 仍放行
    assert eng.evaluate(PolicyEvent("usage_delta", data={"cost": 1.5})).result == "deny"
    assert eng.snapshot()["budget_usd"] == pytest.approx(5.5)


def test_budget_pre_spawn_estimate_denies_when_over(tmp_path):
    eng = make_engine(tmp_path, ("budget", budget_policy_factory(limit_usd=3.0)))
    eng.evaluate(PolicyEvent("usage_delta", data={"cost": 2.0}))
    # 预计 2.0 → 2.0+2.0 > 3.0 → deny
    assert eng.evaluate(PolicyEvent("pre_spawn", data={"estimated_cost": 2.0})).result == "deny"
    # 预计 0.5 → 2.5 ≤ 3.0 → allow
    assert eng.evaluate(PolicyEvent("pre_spawn", data={"estimated_cost": 0.5})).result == "allow"


def test_budget_state_persists_across_instances(tmp_path):
    path = tmp_path / "policies.json"
    eng = make_engine(path, ("budget", budget_policy_factory(limit_usd=1.0)))
    eng.evaluate(PolicyEvent("usage_delta", data={"cost": 0.6}))
    eng.save()
    eng2 = PolicyEngine(state_path=path)
    assert eng2.state["budget_usd"] == pytest.approx(0.6)


# -- 审批策略 ------------------------------------------------------------

def test_approval_allow_prefix_passes(tmp_path):
    eng = make_engine(tmp_path, ("approval", approval_policy_factory(["读取", "review"])))
    ev = PolicyEvent("pre_spawn", data={"prompt": "读取文件并总结", "cli": "claude"})
    assert eng.evaluate(ev).result == "allow"


def test_approval_unmatched_prompts_ask(tmp_path):
    eng = make_engine(tmp_path, ("approval", approval_policy_factory(["读取"])))
    ev = PolicyEvent("pre_spawn", data={"prompt": "删除整个目录", "cli": "claude"})
    decision = eng.evaluate(ev)
    assert decision.result == "ask"
    assert "审批" in decision.reason


def test_approval_allowed_clis_pass(tmp_path):
    eng = make_engine(tmp_path, ("approval", approval_policy_factory(["读取"])))
    ev = PolicyEvent("pre_spawn", data={"prompt": "任意任务", "cli": "codex",
                                        "allowed_clis": ("codex",)})
    assert eng.evaluate(ev).result == "allow"


# -- 工具限权 ------------------------------------------------------------

def test_tool_limit_orchestrate_caps(tmp_path):
    eng = make_engine(tmp_path, ("limit", tool_limit_policy_factory(max_subtasks=3,
                                                                    max_parallel=2)))
    assert eng.evaluate(PolicyEvent("pre_orchestrate",
                                    data={"task_count": 3, "max_workers": 2})).result == "allow"
    assert eng.evaluate(PolicyEvent("pre_orchestrate",
                                    data={"task_count": 4, "max_workers": 2})).result == "deny"
    assert eng.evaluate(PolicyEvent("pre_orchestrate",
                                    data={"task_count": 2, "max_workers": 3})).result == "deny"


def test_tool_limit_spawn_interval(tmp_path):
    eng = make_engine(tmp_path, ("limit", tool_limit_policy_factory(min_spawn_interval=60)))
    assert eng.evaluate(PolicyEvent("pre_spawn", data={})).result == "allow"
    assert eng.evaluate(PolicyEvent("pre_spawn", data={})).result == "deny"


# -- 引擎机制 ------------------------------------------------------------

def test_deny_short_circuits_later_policies(tmp_path):
    """首个 DENY 短路，后续策略不再评估。"""
    calls: list[str] = []

    def p1(ev, state):
        calls.append("p1")
        ev.data["reason"] = "p1 拒绝"
        return PolicyResult.DENY

    def p2(ev, state):
        calls.append("p2")
        return PolicyResult.ALLOW

    eng = make_engine(tmp_path, ("p1", p1), ("p2", p2))
    assert eng.evaluate(PolicyEvent("pre_spawn", data={})).result == "deny"
    assert calls == ["p1"]


def test_policy_exception_fails_safe_to_deny(tmp_path):
    def broken(ev, state):
        raise RuntimeError("boom")

    eng = make_engine(tmp_path, ("broken", broken))
    decision = eng.evaluate(PolicyEvent("pre_spawn", data={}))
    assert decision.result == "deny"
    assert "策略异常" in decision.reason


def test_all_allow_logs_default_decision(tmp_path):
    def passthrough(ev, state):
        return PolicyResult.ALLOW

    eng = make_engine(tmp_path, ("pass", passthrough))
    decision = eng.evaluate(PolicyEvent("pre_spawn", data={}))
    assert decision.result == "allow"
    assert decision.name == "__default__"
    assert len(eng.snapshot()["log"]) == 1


def test_duplicate_policy_name_rejected(tmp_path):
    eng = make_engine(tmp_path, ("p", lambda ev, s: PolicyResult.ALLOW))
    with pytest.raises(ValueError):
        eng.register("p", lambda ev, s: PolicyResult.ALLOW)


def test_snapshot_shape(tmp_path):
    eng = make_engine(tmp_path, ("budget", budget_policy_factory(5.0)))
    eng.evaluate(PolicyEvent("usage_delta", data={"cost": 1.0}))
    snap = eng.snapshot()
    assert set(snap) == {"budget_usd", "spawns", "tool_calls", "policies", "log"}
    assert snap["policies"][0]["name"] == "budget"
