import json

from agent_mcp.daemon_http import EventBroadcaster
from agent_mcp.daemon_main import Dispatcher
from agent_mcp.db import DB

# fixture 裁剪自 tests/test_cli_adapters.py / test_grok_adapter.py /
# test_opencode_adapter.py / test_omp_adapter.py 的实测结构

CLAUDE_ASSISTANT = {"type": "assistant", "message": {"id": "m1", "content": "hi"}}
CLAUDE_RESULT = {
    "type": "result",
    "result": {"stop_reason": "end_turn", "session_id": "s-abc",
               "total_cost_usd": 0.3,
               "usage": {"input_tokens": 100, "output_tokens": 20,
                         "cache_creation_input_tokens": 0,
                         "cache_read_input_tokens": 50}},
}
GROK_MSG = {
    "type": "assistant",
    "message": {"id": "msg_0",
                "content": [{"type": "text", "text": "hi"}],
                "usage": {"input_tokens": 10, "output_tokens": 5}},
    "session_id": "s-grok-1",
}
GROK_RESULT = {
    "type": "result", "is_error": False, "result": "OK",
    "stop_reason": "end_turn", "total_cost_usd": 0.42,
    "usage": {"input_tokens": 100, "output_tokens": 20,
              "cache_read_input_tokens": 50, "cache_creation_input_tokens": 0},
    "session_id": "s-grok-1",
}
OPC_TEXT = {"type": "text", "sessionID": "ses_1",
            "part": {"type": "text", "text": "working"}}
OPC_STEP_FINISH = {
    "type": "step_finish", "sessionID": "ses_1",
    "part": {"type": "step-finish",
             "tokens": {"input": 90, "output": 10, "cache": {"read": 20}},
             "cost": 0.3},
}
OMP_DELTA = {"type": "message_update",
             "assistantMessageEvent": {"type": "text_delta", "delta": "OK"}}
OMP_MSG_END = {
    "type": "message_end",
    "message": {"role": "assistant", "content": [{"type": "text", "text": "OK"}],
                "usage": {"input": 32, "output": 34, "cacheRead": 56832,
                          "cacheWrite": 0,
                          "cost": {"total": 0.0078}},
                "stopReason": "stop"},
}


def _make(tmp_path):
    db = DB(tmp_path / "test.db")
    bc = EventBroadcaster(max_clients=4)
    d = Dispatcher(db=db, broadcaster=bc, state_dir=tmp_path)
    return d, db, bc


def _out(tmp_path, *lines) -> str:
    p = tmp_path / "out.log"
    p.write_text("\n".join(json.dumps(l) for l in lines) + "\n", encoding="utf-8")
    return str(p)


def _listen(bc):
    return bc.connect()


def test_ingest_claude_stream_persists_events_and_usage(tmp_path):
    d, db, bc = _make(tmp_path)
    listener = _listen(bc)
    d._ingest_output(1, "claude", _out(tmp_path, CLAUDE_ASSISTANT, CLAUDE_RESULT), "s1")
    events = db.events_since(0)
    assert [e["type"] for e in events] == ["agent.message", "agent.usage"]
    assert events[0]["payload"]["text"] == "hi"
    use = db.usage_total(1)
    assert use["input_tokens"] == 100 and use["output_tokens"] == 20
    assert use["cache_read"] == 50 and abs(use["cost_usd"] - 0.3) < 1e-9
    text = "".join(listener["buffer"])
    assert "agent.message" in text and "agent.usage" in text


def test_ingest_delta_broadcast_only_not_persisted(tmp_path):
    d, db, bc = _make(tmp_path)
    listener = _listen(bc)
    d._ingest_output(1, "omp", _out(tmp_path, OMP_DELTA), "s1")
    assert db.events_since(0) == []  # delta 不落库
    text = "".join(listener["buffer"])
    assert "agent.message_delta" in text and '"delta": "OK"' in text


def test_ingest_terminated_session_id_backfilled(tmp_path):
    d, db, bc = _make(tmp_path)
    db.insert_agent(parent_id=None, session_id="s1", task_name="t",
                    cli="grok", model=None, cwd=str(tmp_path))
    db.set_status(1, "running", pid=123)
    listener = _listen(bc)
    d._ingest_output(1, "grok", _out(tmp_path, GROK_MSG, GROK_RESULT), "s1")
    agent = db.get_agent(1)
    assert agent["cli_session_id"] == "s-grok-1"  # resume 用
    assert "agent.terminated" not in "".join(listener["buffer"])  # 不重复广播
    assert all(e["type"] != "agent.terminated" for e in db.events_since(0))


def test_ingest_opencode_and_usage_aggregate(tmp_path):
    d, db, bc = _make(tmp_path)
    d._ingest_output(1, "opencode", _out(tmp_path, OPC_TEXT, OPC_STEP_FINISH), "s1")
    events = db.events_since(0)
    types = [e["type"] for e in events]
    assert "agent.message" in types and "agent.usage" in types
    use = db.usage_total(1)
    assert use["input_tokens"] == 90 and use["output_tokens"] == 10
    assert abs(use["cost_usd"] - 0.3) < 1e-9


def test_ingest_empty_output_noop(tmp_path):
    d, db, bc = _make(tmp_path)
    p = tmp_path / "out.log"
    p.write_text("", encoding="utf-8")
    d._ingest_output(1, "claude", str(p), "s1")
    assert db.events_since(0) == []


def test_ingest_unknown_cli_noop(tmp_path):
    d, db, bc = _make(tmp_path)
    d._ingest_output(1, "nonexistent-cli",
                     _out(tmp_path, CLAUDE_ASSISTANT), "s1")
    assert db.events_since(0) == []


def test_ingest_malformed_lines_tolerated(tmp_path):
    d, db, bc = _make(tmp_path)
    p = tmp_path / "out.log"
    p.write_text("not-json{\nnull\n[\"a\"]\n", encoding="utf-8")
    d._ingest_output(1, "claude", str(p), "s1")
    assert db.events_since(0) == []


def test_wait_ingests_events_end_to_end(tmp_path):
    """fake worker 完成路径（wait → _check_worker → _ingest_output）全链路。"""
    calls = []
    def fake_spawn(target_cli, *, prompt, cwd, permission_mode="plan", model=None,
                   max_turns=8, resume=None, state_dir, timeout_seconds=None):
        state_path = tmp_path / "claude-0.json"
        state_path.write_text(json.dumps({"status": "starting"}))
        out_path = tmp_path / "claude-0.out.log"
        out_path.write_text("\n".join(json.dumps(l) for l in
                                      (CLAUDE_ASSISTANT, CLAUDE_RESULT)) + "\n")
        (tmp_path / "claude-0.err.log").write_text("")
        calls.append(1)
        return {"worker_pid": 910001, "command_summary": "claude hi",
                "state_path": str(state_path), "out_path": str(out_path),
                "err_path": str(tmp_path / "claude-0.err.log")}
    d, db, bc = _make(tmp_path)
    d._spawn_fn = fake_spawn
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path)})
        st = json.loads((tmp_path / "claude-0.json").read_text())
        st.update({"status": "finished", "process_status": 0})
        (tmp_path / "claude-0.json").write_text(json.dumps(st))
        res = d.wait({"agent_id": a["agent_id"], "timeout": 10})
        assert res["status"] == "terminated"
        types = [e["type"] for e in db.events_since(0)]
        assert "agent.message" in types and "agent.usage" in types
        assert db.usage_total(a["agent_id"])["input_tokens"] == 100
    finally:
        d.stop()


def test_tail_progress_heartbeat_and_delta_broadcast(tmp_path):
    """运行中增量 tail：新字节 → 心跳 + delta 广播（不落库权威事件）。"""
    import time as _time

    d, db, bc = _make(tmp_path)
    listener = _listen(bc)
    db.insert_agent(parent_id=None, session_id="s1", task_name="t",
                    cli="atomcode", model=None, cwd=str(tmp_path))
    db.set_status(1, "running", pid=123)
    state_path = tmp_path / "w.json"
    state_path.write_text(json.dumps({"status": "running"}))
    out_path = tmp_path / "w.out.log"
    err_path = tmp_path / "w.err.log"
    out_path.write_text("", encoding="utf-8")
    err_path.write_text("", encoding="utf-8")
    d._workers[1] = {"worker_pid": 123, "state_path": str(state_path),
                     "out_path": str(out_path), "err_path": str(err_path)}
    # 无新内容 → 无心跳、无广播
    before = db.get_agent(1)["updated_at"]
    d._tail_progress(1)
    assert db.get_agent(1)["updated_at"] == before
    assert "agent.message_delta" not in "".join(listener["buffer"])
    # 新内容（atomcode stderr 文本行）→ 心跳 + delta 广播（不落库）
    _time.sleep(0.01)
    err_path.write_text("[thinking] analyzing...\n[tool→ bash]\n", encoding="utf-8")
    d._tail_progress(1)
    assert db.get_agent(1)["updated_at"] > before  # 心跳已更新
    assert db.events_since(0) == []  # delta 不落库
    text = "".join(listener["buffer"])
    assert "agent.message_delta" in text and "analyzing" in text
    # JSON 行（claude/omp stream）不广播
    out_path.write_text('{"type":"assistant","message":{"id":"m1","content":"hi"}}\n',
                        encoding="utf-8")
    d._tail_progress(1)
    assert '"content":"hi"' not in "".join(listener["buffer"])


def test_tail_progress_resumes_after_log_truncation(tmp_path):
    """日志被截断（size 回退）→ offset 重置，心跳与 delta 恢复。"""
    d, db, bc = _make(tmp_path)
    listener = _listen(bc)
    db.insert_agent(parent_id=None, session_id="s1", task_name="t",
                    cli="atomcode", model=None, cwd=str(tmp_path))
    db.set_status(1, "running", pid=123)
    state_path = tmp_path / "w.json"
    state_path.write_text(json.dumps({"status": "running"}))
    out_path = tmp_path / "w.out.log"
    err_path = tmp_path / "w.err.log"
    out_path.write_text("", encoding="utf-8")
    err_path.write_text("", encoding="utf-8")
    d._workers[1] = {"worker_pid": 123, "state_path": str(state_path),
                     "out_path": str(out_path), "err_path": str(err_path)}
    err_path.write_text("[thinking] first pass\n", encoding="utf-8")
    d._tail_progress(1)
    assert "first pass" in "".join(listener["buffer"])
    # 模拟外部截断：文件变小（size < 已 tail offset）
    err_path.write_text("", encoding="utf-8")
    out_path.write_text("", encoding="utf-8")
    d._tail_progress(1)  # 不抛错，offset 重置
    err_path.write_text("[thinking] after truncation\n", encoding="utf-8")
    d._tail_progress(1)
    assert "after truncation" in "".join(listener["buffer"])  # 心跳/delta 恢复
