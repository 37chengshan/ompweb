"""策略 enforcement 集成测试（daemon 级）：Dispatcher.spawn 拦截 + usage 回灌 +
policy 管理方法。全部 fake spawn，不起真实 CLI。"""
import json

import pytest

from agent_mcp.daemon_http import EventBroadcaster
from agent_mcp.daemon_main import Dispatcher
from agent_mcp.db import DB


def _make(tmp_path, *, env_patch: dict | None = None, limits: dict | None = None):
    import os
    old = {}
    if env_patch:
        for k, v in env_patch.items():
            old[k] = os.environ.get(k)
            os.environ[k] = v
    db = DB(tmp_path / "test.db")
    bc = EventBroadcaster(max_clients=4)
    d = Dispatcher(db=db, broadcaster=bc, state_dir=tmp_path,
                   max_concurrent=4, monitor_interval=0.05)
    return d, db, bc, old


@pytest.fixture()
def spawn_env(monkeypatch):
    """默认：approval 白名单空（不拦截），budget 大额。"""
    monkeypatch.setenv("AGENT_MCP_ALLOW_PREFIXES", "")
    monkeypatch.setenv("AGENT_MCP_BUDGET_USD", "100.0")


def _fake_spawn(tmp_path):
    calls = []
    def spawn_fn(*args, **kwargs):
        calls.append((args, kwargs))
        info = {"worker_pid": 999999, "out_path": tmp_path / "out.txt",
                "err_path": tmp_path / "err.txt"}
        (tmp_path / "out.txt").write_text("")
        (tmp_path / "err.txt").write_text("")
        return info
    return spawn_fn, calls


def test_spawn_denied_by_budget_via_usage(spawn_env, tmp_path):
    """usage_delta 累计超限后，下一次 pre_spawn 被 DENY。"""
    fake, _ = _fake_spawn(tmp_path)
    d, db, bc, _ = _make(tmp_path)
    from agent_mcp.policies.builtin import budget_policy_factory
    d.policy_engine.unregister("budget_policy")
    d.policy_engine.register("budget_policy", budget_policy_factory(limit_usd=5.0))
    # 第一次 spawn 允许
    res = d.spawn({"target_cli": "claude", "prompt": "x", "cwd": "/tmp",
                   "session_id": "s1", "permission_mode": "plan"})
    assert res["status"] in ("running", "queued")
    # 回灌 usage 4 + 4 = 8 > 5
    d.policy_engine.evaluate(type("E", (), {"type": "usage_delta",
                                            "data": {"cost": 4.0}})())
    d.policy_engine.evaluate(type("E", (), {"type": "usage_delta",
                                            "data": {"cost": 4.0}})())
    d.policy_engine.save()
    # 新 spawn 被 budget 拒绝
    res2 = d.spawn({"target_cli": "codex", "prompt": "y", "cwd": "/tmp",
                    "session_id": "s1", "permission_mode": "plan"})
    assert res2["status"] == "denied"
    assert res2["policy"] == "budget_policy"


def test_spawn_denied_by_approval(spawn_env, tmp_path, monkeypatch):
    """未命中白名单前缀 → ASK → 无审批通道 = denied。"""
    monkeypatch.setenv("AGENT_MCP_ALLOW_PREFIXES", "读取")
    fake, _ = _fake_spawn(tmp_path)
    d, db, bc, _ = _make(tmp_path)
    res = d.spawn({"target_cli": "claude", "prompt": "删除目录", "cwd": "/tmp",
                   "session_id": "s1"})
    assert res["status"] == "denied"
    assert res["result"] == "ask"
    # 命中前缀 → 放行
    res2 = d.spawn({"target_cli": "claude", "prompt": "读取配置", "cwd": "/tmp",
                    "session_id": "s1"})
    assert res2["status"] in ("running", "queued")


def test_spawn_increments_spawns_counter(spawn_env, tmp_path):
    fake, _ = _fake_spawn(tmp_path)
    d, db, bc, _ = _make(tmp_path)
    d.spawn({"target_cli": "claude", "prompt": "x", "cwd": "/tmp", "session_id": "s1"})
    d.spawn({"target_cli": "claude", "prompt": "y", "cwd": "/tmp", "session_id": "s1"})
    assert d.policy_engine.state["spawns"] == 2


def test_usage_delta_publishes_policy_decision(spawn_env, tmp_path):
    """usage 超限时广播 policy_decision SSE 事件（面板订阅）。"""
    fake, _ = _fake_spawn(tmp_path)
    d, db, bc, _ = _make(tmp_path)
    from agent_mcp.policies.builtin import budget_policy_factory
    d.policy_engine.unregister("budget_policy")
    d.policy_engine.register("budget_policy", budget_policy_factory(limit_usd=1.0))
    # 直接走 ingest 路径（worker 完成 → usage 回灌）
    agent_id = db.insert_agent(parent_id=None, session_id="s1", task_name="",
                               cli="claude", model=None, cwd="/tmp",
                               permission_mode="plan")
    out = tmp_path / "out.jsonl"
    out.write_text(json.dumps({"type": "result", "stop_reason": "end_turn",
                               "session_id": "s-x", "total_cost_usd": 2.0,
                               "usage": {"input_tokens": 1, "output_tokens": 1,
                                         "cache_creation_input_tokens": 0,
                                         "cache_read_input_tokens": 0}}))
    # 捕获广播
    seen = []
    orig_broadcast = d._broadcast
    def spy(type_, payload, agent_id):
        seen.append((type_, payload))
        return orig_broadcast(type_, payload, agent_id)
    d._broadcast = spy
    d._ingest_output(agent_id, "claude", out, "s1")
    assert any(t == "policy_decision" for t, _ in seen)


def test_policy_add_tighten_only(spawn_env, tmp_path):
    """budget 只能收紧；放宽被拒。"""
    d, db, bc, _ = _make(tmp_path)
    ok = d.policy_add({"name": "budget_policy", "params": {"limit_usd": 5.0}})
    assert ok["status"] == "ok"
    with pytest.raises(ValueError):
        d.policy_add({"name": "budget_policy", "params": {"limit_usd": 999.0}})


def test_policy_add_unknown_rejected(spawn_env, tmp_path):
    d, db, bc, _ = _make(tmp_path)
    with pytest.raises(ValueError):
        d.policy_add({"name": "nope", "params": {}})


def test_policy_list_and_state_shape(spawn_env, tmp_path):
    d, db, bc, _ = _make(tmp_path)
    listed = d.policy_list({})
    assert "policies" in listed and "state" in listed
    snap = d.policy_state({})
    assert set(snap) >= {"budget_usd", "spawns", "tool_calls", "policies", "log",
                         "policy_configs"}
    # policies 是数组（面板 .map 可用，H5）
    assert isinstance(snap["policies"], list)
    assert isinstance(snap["log"], list)
