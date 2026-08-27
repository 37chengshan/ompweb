"""B3 用户预声明跨底座降档链测试。

铁律（路线图 B3 DoD）：未配置 downgrade_chain 时行为与 v2 完全一致
（同 CLI 降一档、仅广播提示）；配置后按链广播明确的下一跳组合，
执行入口是 followup 的 target_cli 显式覆盖——系统永不擅自更换底座。
"""
import json

import pytest

from agent_mcp.daemon_http import EventBroadcaster
from agent_mcp.daemon_main import Dispatcher
from agent_mcp.db import DB


class NoopWorker:
    def __init__(self):
        self.spawned = []

    def __call__(self, target_cli, **kwargs):
        self.spawned.append((target_cli, kwargs))
        return {"worker_pid": 0, "command_summary": "noop",
                "state_path": "", "out_path": "", "err_path": ""}


@pytest.fixture()
def env(tmp_path):
    db = DB(tmp_path / "d.sqlite3")
    worker = NoopWorker()
    disp = Dispatcher(db=db, broadcaster=EventBroadcaster(),
                      state_dir=tmp_path / "state", spawn_fn=worker)
    yield {"db": db, "disp": disp, "worker": worker}


def make_terminated_agent(env, *, model="claude-opus-4-6", cli="claude",
                          tokens=99999):
    db = env["db"]
    agent_id = db.insert_agent(parent_id=None, session_id="s", task_name="t",
                               cli=cli, model=model,
                               cwd=str(env["disp"].state_dir))
    db.set_status(agent_id, "terminated", stop_reason="end_turn")
    db.upsert_usage(agent_id=agent_id, model="aggregate",
                    input_tokens=tokens, output_tokens=tokens,
                    cache_creation=0, cache_read=0, cost_usd=1.0)
    return agent_id


def downgrade_events(env):
    return [e for e in env["db"].events_since(0)
            if e["type"] == "agent.budget_downgrade"]


BASE_BODY = {"token_budget": 100}  # 阈值远低于 usage，必然超额


def test_no_chain_keeps_v2_behavior(env):
    """未配置链：同 CLI 降一档、仅广播 from/to，与 v2 完全一致。"""
    agent_id = make_terminated_agent(env, model="claude-opus-4-6")
    body = dict(BASE_BODY, model="claude-opus-4-6")
    env["disp"]._maybe_downgrade_on_budget(agent_id, env["db"].get_agent(agent_id), body)
    events = downgrade_events(env)
    assert len(events) == 1
    payload = events[0]["payload"]  # db 层已解析为 dict
    assert payload["to"] == "claude-sonnet-4-6"
    assert "to_cli" not in payload          # 不涉及跨底座
    assert env["worker"].spawned == []      # v2 不自动重跑


def test_chain_broadcasts_declared_next_step(env):
    agent_id = make_terminated_agent(env)
    body = {**BASE_BODY, "_downgrade_step": 0,
            "downgrade_chain": [{"cli": "omp", "model": "smol"},
                                 {"cli": "pi"}]}
    env["disp"]._maybe_downgrade_on_budget(agent_id, env["db"].get_agent(agent_id), body)
    events = downgrade_events(env)
    assert len(events) == 1
    payload = events[0]["payload"]
    assert payload["to_cli"] == "omp"
    assert payload["chain_step"] == 1 and payload["chain_len"] == 2
    assert "followup" in payload["hint"]


def test_chain_exhausted_stops_promoting(env):
    agent_id = make_terminated_agent(env)
    body = {**BASE_BODY, "_downgrade_step": 2,
            "downgrade_chain": [{"cli": "omp"}, {"cli": "pi"}]}
    env["disp"]._maybe_downgrade_on_budget(agent_id, env["db"].get_agent(agent_id), body)
    assert downgrade_events(env) == []


def test_followup_target_cli_override_switches_harness(env):
    agent_id = make_terminated_agent(env, cli="claude")
    res = env["disp"].followup({"agent_id": agent_id, "prompt": "redo cheaper",
                                "session_id": "s", "target_cli": "omp",
                                "model": "smol"})
    assert res["status"] in ("running", "queued")
    assert env["worker"].spawned[0][0] == "omp"
    assert env["db"].get_agent(agent_id)["cli"] == "omp"  # 归属同步


def test_followup_target_cli_rejects_unknown_cli(env):
    agent_id = make_terminated_agent(env, cli="claude")
    with pytest.raises(ValueError):
        env["disp"].followup({"agent_id": agent_id, "prompt": "x",
                              "target_cli": "not-a-cli"})
    # 原 CLI 未被破坏
    assert env["db"].get_agent(agent_id)["cli"] == "claude"


def test_schemas_advertise_b3_fields():
    from mcp_server import TOOLS
    spawn = next(t for t in TOOLS if t["name"] == "spawn_agent")
    follow = next(t for t in TOOLS if t["name"] == "followup_task")
    assert "downgrade_chain" in spawn["inputSchema"]["properties"]
    chain = spawn["inputSchema"]["properties"]["downgrade_chain"]
    assert chain["items"]["required"] == ["cli"]
    assert chain["items"]["additionalProperties"] is False
    assert "target_cli" in follow["inputSchema"]["properties"]
    assert "model" in follow["inputSchema"]["properties"]
