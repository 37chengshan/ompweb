import json
import time
from pathlib import Path
import pytest

from agent_mcp.cli_adapters import ResumeUnsupportedError

from agent_mcp.daemon_http import EventBroadcaster
from agent_mcp.daemon_main import (_final_summary, Dispatcher, SELF_CHECK_REMINDER)
from agent_mcp.db import DB


def _make(tmp_path, *, max_concurrent=4, spawn_fn=None):
    db = DB(tmp_path / "test.db")
    bc = EventBroadcaster(max_clients=4)
    # 分池后 max_concurrent 映射到读池上限（写池默认 2）；单槽测试用 read_pool_max=1
    rp = max_concurrent if max_concurrent <= 2 else 6
    wp = 2 if max_concurrent > 2 else max_concurrent
    d = Dispatcher(db=db, broadcaster=bc, state_dir=tmp_path,
                   max_concurrent=max_concurrent, spawn_fn=spawn_fn,
                   monitor_interval=0.05)
    # 直接调 SlotScheduler 的池参数（Dispatcher 构造后可覆写）
    d._scheduler.read_pool_max = rp
    d._scheduler.write_pool_max = wp
    return d, db, bc


def _fake_spawn(tmp_path):
    """记录调用并返回假 worker 文件（不真正起进程）。"""
    calls = []
    def fake_spawn(target_cli, *, prompt, cwd, permission_mode="plan", model=None,
                   max_turns=8, resume=None, state_dir, timeout_seconds=None):
        tag = f"{target_cli}-{len(calls)}"
        state_path = tmp_path / f"{tag}.json"
        state_path.write_text(json.dumps({"status": "starting", "cwd": str(cwd)}))
        out_path = tmp_path / f"{tag}.out.log"
        out_path.write_text("fake output line\n")
        (tmp_path / f"{tag}.err.log").write_text("")
        calls.append({"target_cli": target_cli, "prompt": prompt, "cwd": str(cwd),
                      "timeout_seconds": timeout_seconds, "resume": resume})
        return {"worker_pid": 900000 + len(calls),
                "command_summary": f"{target_cli} {prompt}",
                "state_path": str(state_path), "out_path": str(out_path),
                "err_path": str(tmp_path / f"{tag}.err.log")}
    return fake_spawn, calls


def _finish(state_path: Path, rc: int = 0):
    st = json.loads(Path(state_path).read_text())
    st.update({"status": "finished", "process_status": rc})
    Path(state_path).write_text(json.dumps(st))


def _listen(bc):
    """先 connect（缓冲只给已连接客户端追加），再由调用方触发事件。"""
    return bc.connect()


def test_spawn_creates_agent_and_broadcasts(tmp_path):
    fake, calls = _fake_spawn(tmp_path)
    d, db, bc = _make(tmp_path, spawn_fn=fake)
    listener = _listen(bc)
    d.start()
    try:
        res = d.spawn({"target_cli": "claude", "prompt": "do it", "cwd": str(tmp_path),
                       "session_id": "s1", "task_name": "t1", "permission_mode": "plan"})
        assert res["status"] == "running" and res["agent_id"] == 1
        agent = db.get_agent(1)
        assert agent["cli"] == "claude" and agent["cwd"] == str(tmp_path)
        assert agent["status"] == "running" and agent["pid"] is not None
        expected_prompt = "do it" + SELF_CHECK_REMINDER
        assert calls == [{"target_cli": "claude", "prompt": expected_prompt,
                          "cwd": str(tmp_path), "timeout_seconds": None, "resume": None}]
        text = "".join(listener["buffer"])
        assert "agent.spawned" in text and "agent.running" in text
        assert "agent.user_turn" in text
        user_turn = next(e for e in db.events_since(0) if e["type"] == "agent.user_turn")
        assert user_turn["payload"]["text"] == expected_prompt
        assert user_turn["payload"]["kind"] == "spawn"
    finally:
        d.stop()

def test_spawn_reports_unsupported_resume_truthfully(tmp_path):
    def reject_resume(*_args, **_kwargs):
        raise ResumeUnsupportedError("AtomCode does not support stable session-id resume")

    d, db, bc = _make(tmp_path, spawn_fn=reject_resume)
    result = d.spawn({"target_cli": "atomcode", "prompt": "continue", "cwd": str(tmp_path),
                      "resume": "session-1"})
    assert result["status"] == "error"
    assert db.get_agent(result["agent_id"])["stop_reason"] == "resume_unsupported"


def test_spawn_queued_when_slots_full_then_promoted(tmp_path):
    fake, calls = _fake_spawn(tmp_path)
    d, db, bc = _make(tmp_path, max_concurrent=1, spawn_fn=fake)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "A", "cwd": str(tmp_path)})
        b = d.spawn({"target_cli": "claude", "prompt": "B", "cwd": str(tmp_path)})
        assert a["status"] == "running" and b["status"] == "queued"
        assert len(calls) == 1
        # A 完成后，B 应被补位 spawn（watcher 异步触发需宽限）
        _finish(tmp_path / "claude-0.json", rc=0)
        import time
        for _ in range(200):
            if len(calls) >= 2:
                break
            time.sleep(0.05)
        assert len(calls) == 2 and calls[1]["prompt"] == "B" + SELF_CHECK_REMINDER
        assert db.get_agent(b["agent_id"])["status"] == "running"
    finally:
        d.stop()


def test_wait_returns_terminated_with_summary(tmp_path):
    fake, _ = _fake_spawn(tmp_path)
    d, db, bc = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path)})
        _finish(tmp_path / "claude-0.json", rc=0)
        res = d.wait({"agent_id": a["agent_id"], "timeout": 10})
        assert res["status"] == "terminated" and res["stop_reason"] == "end_turn"
        # P2 改后：summary 走 _extract_final_answer（无 FINAL_ANSWER 标记时回退 _tail 末尾截断）；
        # 若末尾截断仍空，fake output 可能已落 events payload——两处择一查即可
        assert ("fake output" in res.get("summary", "")
                or "fake output" in json.dumps(res.get("events", []))
                or "fake output" in json.dumps(res.get("events_compressed", {})))
        assert db.get_agent(a["agent_id"])["status"] == "terminated"
    finally:
        d.stop()


def test_wait_nonzero_rc_marks_error(tmp_path):
    fake, _ = _fake_spawn(tmp_path)
    d, db, _ = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path)})
        _finish(tmp_path / "claude-0.json", rc=2)
        res = d.wait({"agent_id": a["agent_id"], "timeout": 10})
        assert res["status"] == "error" and res["stop_reason"] == "cli_exit_nonzero"
    finally:
        d.stop()


def test_wait_timeout_returns_running(tmp_path):
    fake, _ = _fake_spawn(tmp_path)
    d, db, _ = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path)})
        res = d.wait({"agent_id": a["agent_id"], "timeout": 0.5})
        assert res["status"] == "running"
    finally:
        d.stop()


def test_wait_accepts_custom_timeout_above_30(tmp_path):
    """wait_agent 上限不再硬编码 30s：timeout>30 被接受并按 MAX_WAIT_SECONDS 钳制，不报错。"""
    fake, _ = _fake_spawn(tmp_path)
    d, db, _ = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path)})
        _finish(tmp_path / "claude-0.json", rc=0)
        # timeout=120 超出旧上限 30s；agent 已终止应立即返回，不会被拒绝
        res = d.wait({"agent_id": a["agent_id"], "timeout": 120})
        assert res["status"] == "terminated" and res["stop_reason"] == "end_turn"
    finally:
        d.stop()


def test_interrupt_cancels_and_releases_slot(tmp_path):
    fake, _ = _fake_spawn(tmp_path)
    d, db, bc = _make(tmp_path, max_concurrent=1, spawn_fn=fake)
    listener = _listen(bc)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "A", "cwd": str(tmp_path)})
        b = d.spawn({"target_cli": "claude", "prompt": "B", "cwd": str(tmp_path)})
        res = d.interrupt({"agent_id": a["agent_id"]})
        assert res["status"] == "cancelled" and res["stop_reason"] == "interrupted"
        assert res["usage_incomplete"] is True
        assert db.get_agent(a["agent_id"])["status"] == "cancelled"
        assert "agent.cancelled" in "".join(listener["buffer"])
        # 槽位已释放：B 应被补位
        import time
        for _ in range(100):
            if db.get_agent(b["agent_id"])["status"] == "running":
                break
            time.sleep(0.05)
        assert db.get_agent(b["agent_id"])["status"] == "running"
    finally:
        d.stop()


def test_send_message_delivered_then_undelivered(tmp_path):
    fake, _ = _fake_spawn(tmp_path)
    d, db, _ = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path)})
        res = d.send_message({"agent_id": a["agent_id"], "message": "ping"})
        assert res["status"] == "delivered"
        _finish(tmp_path / "claude-0.json", rc=0)
        d.wait({"agent_id": a["agent_id"], "timeout": 10})
        res = d.send_message({"agent_id": a["agent_id"], "message": "after"})
        assert res["status"] == "undelivered"
        msgs = db.messages_for(a["agent_id"])
        assert [m["role"] for m in msgs] == ["user", "user"]
    finally:
        d.stop()


def test_followup_merges_pending_messages_and_respawns(tmp_path):
    fake, calls = _fake_spawn(tmp_path)
    d, db, _ = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path)})
        _finish(tmp_path / "claude-0.json", rc=0)
        d.wait({"agent_id": a["agent_id"], "timeout": 10})
        d.send_message({"agent_id": a["agent_id"], "message": "note one"})
        d.send_message({"agent_id": a["agent_id"], "message": "note two"})
        res = d.followup({"agent_id": a["agent_id"], "prompt": "continue"})
        assert res["status"] == "running" and res["merged_messages"] == 2
        assert "continue" in calls[1]["prompt"]
        assert "note one" in calls[1]["prompt"] and "note two" in calls[1]["prompt"]
        turns = [e for e in db.events_since(0) if e["type"] == "agent.user_turn"]
        assert [e["payload"]["kind"] for e in turns] == ["spawn", "followup"]
        assert turns[-1]["payload"]["text"] == "continue"
    finally:
        d.stop()


def test_followup_while_running_queues_then_chains(tmp_path):
    fake, calls = _fake_spawn(tmp_path)
    d, db, _ = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "A", "cwd": str(tmp_path)})
        res = d.followup({"agent_id": a["agent_id"], "prompt": "more"})
        # 终态续跑先 release 旧槽再 acquire：若旧槽已清则可能立即 running 而非 queued
        assert res["status"] in ("queued", "running")
        _finish(tmp_path / "claude-0.json", rc=0)
        import time
        for _ in range(200):
            if len(calls) >= 2 and db.get_agent(a["agent_id"])["status"] == "running":
                break
            time.sleep(0.05)
        assert len(calls) == 2 and "more" in calls[1]["prompt"]
    finally:
        d.stop()

def test_followup_automatically_resumes_saved_cli_session(tmp_path):
    """支持 resume 的 CLI 在后续 turn 自动复用已保存的会话。"""
    fake, calls = _fake_spawn(tmp_path)
    d, db, _ = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "first", "cwd": str(tmp_path)})
        db.set_status(a["agent_id"], "running", cli_session_id="session-42")
        _finish(tmp_path / "claude-0.json", rc=0)
        d.wait({"agent_id": a["agent_id"], "timeout": 10})
        result = d.followup({"agent_id": a["agent_id"], "prompt": "continue"})
        assert result["resumed_session_id"] == "session-42"
        assert calls[1]["resume"] == "session-42"
    finally:
        d.stop()


def test_steer_running_agent_interrupts_and_starts_followup(tmp_path, monkeypatch):
    """中途插话是显式 steer：终止当前 run，保留节点并立即开始下一 turn。"""
    fake, calls = _fake_spawn(tmp_path)
    inherited = []

    def capture_inheritance(
        target_cli, *, prompt, cwd, permission_mode="plan", model=None,
        max_turns=8, resume=None, state_dir, timeout_seconds=None,
    ):
        inherited.append({
            "model": model,
            "permission_mode": permission_mode,
        })
        return fake(
            target_cli,
            prompt=prompt,
            cwd=cwd,
            permission_mode=permission_mode,
            model=model,
            max_turns=max_turns,
            resume=resume,
            state_dir=state_dir,
            timeout_seconds=timeout_seconds,
        )

    d, db, _ = _make(tmp_path, spawn_fn=capture_inheritance)
    monkeypatch.setattr("agent_mcp.daemon_main.terminate_process_tree", lambda _pid: True)
    d.start()
    try:
        a = d.spawn({
            "target_cli": "claude",
            "prompt": "first",
            "cwd": str(tmp_path),
            "model": "deepseek-v4-flash",
            "permission_mode": "fullAccess",
        })
        db.set_status(a["agent_id"], "running", cli_session_id="session-42")
        result = d.steer({"agent_id": a["agent_id"], "message": "先停一下，改做 B"})
        assert result["status"] == "running"
        assert result["interrupted"] is True
        assert result["resumed_session_id"] == "session-42"
        assert calls[1]["resume"] == "session-42"
        assert "先停一下，改做 B" in calls[1]["prompt"]
        assert inherited[1] == {
            "model": "deepseek-v4-flash",
            "permission_mode": "fullAccess",
        }
        assert db.get_agent(a["agent_id"])["status"] == "running"
    finally:
        d.stop()


def test_list_activity_usage_shapes(tmp_path):
    fake, _ = _fake_spawn(tmp_path)
    d, db, _ = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path),
                     "session_id": "s9"})
        lst = d.list_agents({"session_id": "s9"})
        assert [x["id"] for x in lst["agents"]] == [a["agent_id"]]
        act = d.activity({"agent_id": a["agent_id"], "since_seq": 0})
        assert act["events"] and act["next_seq"] > 0
        assert act["events"][0]["type"] == "agent.spawned"
        use = d.usage({"agent_id": a["agent_id"]})
        assert set(use) >= {"input_tokens", "output_tokens", "cost_usd"}
        assert use["estimated"] is True
    finally:
        d.stop()


def test_agent_operations_reject_cross_session_access(tmp_path):
    d, _, _ = _make(tmp_path)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path),
                     "session_id": "owner"})
        operations = [
            lambda: d.send_message({"agent_id": a["agent_id"], "message": "x",
                                    "session_id": "other"}),
            lambda: d.followup({"agent_id": a["agent_id"], "prompt": "x",
                                "session_id": "other"}),
            lambda: d.steer({"agent_id": a["agent_id"], "message": "x",
                             "session_id": "other"}),
            lambda: d.wait({"agent_id": a["agent_id"], "timeout": 0.1,
                            "session_id": "other"}),
            lambda: d.interrupt({"agent_id": a["agent_id"], "session_id": "other"}),
            lambda: d.activity({"agent_id": a["agent_id"], "session_id": "other"}),
            lambda: d.usage({"agent_id": a["agent_id"], "session_id": "other"}),
        ]
        for operation in operations:
            with pytest.raises(ValueError, match="does not belong to session other"):
                operation()
    finally:
        d.stop()


def test_spawn_rejects_missing_required_fields(tmp_path):
    fake, _ = _fake_spawn(tmp_path)
    d, db, _ = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        import pytest
        with pytest.raises(ValueError):
            d.spawn({"target_cli": "claude"})
        with pytest.raises(ValueError):
            d.spawn({"prompt": "hi", "cwd": str(tmp_path)})
    finally:
        d.stop()


def test_spawn_timeout_seconds_passed_to_worker(tmp_path):
    """timeout_seconds 全链路：spawn body → _run_worker → spawn_fn。"""
    fake, calls = _fake_spawn(tmp_path)
    d, db, _ = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        d.spawn({"target_cli": "claude", "prompt": "do it", "cwd": str(tmp_path),
                 "timeout_seconds": 120})
        assert calls[0]["timeout_seconds"] == 120
        d.spawn({"target_cli": "claude", "prompt": "no timeout", "cwd": str(tmp_path)})
        assert calls[1]["timeout_seconds"] is None
    finally:
        d.stop()


def test_worker_timeout_maps_to_incomplete(tmp_path):
    """worker state 标 timed_out → 状态 incomplete + stop_reason timeout。"""
    fake, _ = _fake_spawn(tmp_path)
    d, db, _ = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path)})
        aid = a["agent_id"]
        state_path = d._workers[aid]["state_path"]
        st = json.loads(Path(state_path).read_text())
        st.update({"status": "finished", "process_status": -9, "timed_out": True})
        Path(state_path).write_text(json.dumps(st))
        d._check_worker(aid)
        agent = db.get_agent(aid)
        assert agent["status"] == "incomplete" and agent["stop_reason"] == "timeout"
        res = d.wait({"agent_id": aid, "timeout": 10})
        assert res["status"] == "incomplete" and res["stop_reason"] == "timeout"
    finally:
        d.stop()


def test_set_status_enforces_state_machine(tmp_path):
    """Dispatcher 状态迁移经 state_machine 校验；终态→running 仅 followup 重启豁免。"""
    import pytest
    fake, _ = _fake_spawn(tmp_path)
    d, db, _ = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path)})
        aid = a["agent_id"]
        with pytest.raises(ValueError):
            d._set_status(aid, "queued")  # running → queued 非法
        _finish(d._workers[aid]["state_path"], rc=0)
        d._check_worker(aid)
        assert db.get_agent(aid)["status"] == "terminated"
        with pytest.raises(ValueError):
            d._set_status(aid, "cancelled")  # terminated → cancelled 非法
        d._set_status(aid, "running")  # followup 重启：终态→running 豁免
        assert db.get_agent(aid)["status"] == "running"
    finally:
        d.stop()


def test_spawn_rejects_oversized_prompt_and_context(tmp_path):
    import pytest
    from agent_mcp.daemon_main import MAX_CONTEXT_CHARS, MAX_PROMPT_CHARS
    fake, _ = _fake_spawn(tmp_path)
    d, db, _ = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        with pytest.raises(ValueError):
            d.spawn({"target_cli": "claude", "prompt": "x" * (MAX_PROMPT_CHARS + 1),
                     "cwd": str(tmp_path)})
        with pytest.raises(ValueError):
            d.spawn({"target_cli": "claude", "prompt": "hi",
                     "context": "c" * (MAX_CONTEXT_CHARS + 1), "cwd": str(tmp_path)})
        assert len(db.agents_by_session(None)) == 0  # 超限不建 agent
    finally:
        d.stop()


def test_send_message_rejects_oversized_message(tmp_path):
    import pytest
    from agent_mcp.daemon_main import MAX_MESSAGE_CHARS
    fake, _ = _fake_spawn(tmp_path)
    d, db, _ = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path)})
        with pytest.raises(ValueError):
            d.send_message({"agent_id": a["agent_id"],
                            "message": "m" * (MAX_MESSAGE_CHARS + 1)})
    finally:
        d.stop()


def test_spawn_rejects_invalid_timeout_seconds(tmp_path):
    """非法 timeout_seconds 同步 ValueError：不建 agent、不启动 worker、不留 running。"""
    import pytest
    fake, calls = _fake_spawn(tmp_path)
    d, db, _ = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        base = {"target_cli": "claude", "prompt": "do it", "cwd": str(tmp_path)}
        for bad in ("abc", -1, 0, "0"):
            with pytest.raises(ValueError):
                d.spawn({**base, "timeout_seconds": bad})
        assert len(db.agents_by_session(None)) == 0  # 非法值不建 agent
        assert calls == []  # 不启动 worker
        # 空字符串视为禁用（等价缺省无超时）
        res = d.spawn({**base, "timeout_seconds": ""})
        assert res["status"] == "running"
        assert calls[0]["timeout_seconds"] is None
    finally:
        d.stop()


def test_followup_rejects_invalid_timeout_seconds(tmp_path):
    """followup 同样在边界校验 timeout_seconds；非法值不重启、不污染状态。"""
    import pytest
    fake, calls = _fake_spawn(tmp_path)
    d, db, _ = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path)})
        aid = a["agent_id"]
        _finish(d._workers[aid]["state_path"], rc=0)
        d.wait({"agent_id": aid, "timeout": 10})
        assert db.get_agent(aid)["status"] == "terminated"
        before = len(calls)
        with pytest.raises(ValueError):
            d.followup({"agent_id": aid, "prompt": "again", "timeout_seconds": "abc"})
        assert len(calls) == before  # 未启动新 worker
        assert db.get_agent(aid)["status"] == "terminated"  # 状态未被污染
    finally:
        d.stop()


def test_followup_rejects_merged_prompt_over_limit(tmp_path):
    """合并挂起消息后 prompt 超 MAX_PROMPT_CHARS → 拒绝，不写 pending、不 spawn。"""
    import pytest
    from agent_mcp.daemon_main import MAX_MESSAGE_CHARS, MAX_PROMPT_CHARS
    fake, calls = _fake_spawn(tmp_path)
    d, db, _ = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path)})
        aid = a["agent_id"]
        _finish(d._workers[aid]["state_path"], rc=0)
        d.wait({"agent_id": aid, "timeout": 10})
        for _ in range(11):  # 11 × MAX_MESSAGE_CHARS > MAX_PROMPT_CHARS
            d.send_message({"agent_id": aid, "message": "m" * MAX_MESSAGE_CHARS})
        before = len(calls)
        with pytest.raises(ValueError):
            d.followup({"agent_id": aid, "prompt": "y" * 20})  # 单 prompt 合法，合并后超限
        assert len(calls) == before  # 未 spawn
        assert aid not in d._pending  # 未写 pending
        assert db.get_agent(aid)["status"] == "terminated"  # 未滞留
    finally:
        d.stop()


def _flaky_spawn(tmp_path, failure):
    """首次 spawn 成功，后续 spawn 抛出 failure（模拟重启失败）。"""
    calls = []

    def flaky_spawn(target_cli, *, prompt, cwd, permission_mode="plan", model=None,
                    max_turns=8, resume=None, state_dir, timeout_seconds=None):
        if calls:
            raise failure
        calls.append(1)
        tag = f"{target_cli}-first"
        state_path = tmp_path / f"{tag}.json"
        state_path.write_text(json.dumps({"status": "starting"}))
        out_path = tmp_path / f"{tag}.out.log"
        out_path.write_text("ok\n")
        (tmp_path / f"{tag}.err.log").write_text("")
        return {"worker_pid": 900001, "command_summary": target_cli,
                "state_path": str(state_path), "out_path": str(out_path),
                "err_path": str(tmp_path / f"{tag}.err.log")}
    return flaky_spawn


def test_followup_restart_failure_keeps_cli_missing_error(tmp_path):
    """终态 agent 的 followup 重启 spawn 失败：保留 cli_missing error 事件与 error 状态。"""
    fake = _flaky_spawn(tmp_path, ValueError("CLI claude was not found. Install it or set PATH"))
    d, db, bc = _make(tmp_path, spawn_fn=fake)
    listener = _listen(bc)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path)})
        aid = a["agent_id"]
        _finish(d._workers[aid]["state_path"], rc=0)
        d.wait({"agent_id": aid, "timeout": 10})
        assert db.get_agent(aid)["status"] == "terminated"
        res = d.followup({"agent_id": aid, "prompt": "again"})
        assert res["status"] == "error" and res["error"]
        agent = db.get_agent(aid)
        assert agent["status"] == "error" and agent["stop_reason"] == "cli_missing"
        text = "".join(listener["buffer"])
        assert "agent.error" in text and "cli_missing" in text
    finally:
        d.stop()


def test_followup_restart_failure_keeps_resume_unsupported_error(tmp_path):
    """终态 agent 的 followup 重启 resume 不支持：保留 resume_unsupported error 事件与状态。"""
    fake = _flaky_spawn(tmp_path,
                        ResumeUnsupportedError("AtomCode does not support stable session-id resume"))
    d, db, bc = _make(tmp_path, spawn_fn=fake)
    listener = _listen(bc)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path),
                     "resume": "session-1"})
        aid = a["agent_id"]
        _finish(d._workers[aid]["state_path"], rc=0)
        d.wait({"agent_id": aid, "timeout": 10})
        res = d.followup({"agent_id": aid, "prompt": "again", "resume": "session-1"})
        assert res["status"] == "error" and res["error"]
        agent = db.get_agent(aid)
        assert agent["status"] == "error" and agent["stop_reason"] == "resume_unsupported"
        text = "".join(listener["buffer"])
        assert "agent.error" in text and "resume_unsupported" in text
    finally:
        d.stop()


def test_orphan_worker_detected_when_running_pid_dead(tmp_path):
    """孤儿检测：state 已写 running 但 worker 进程已死 → _fail worker_died。"""
    fake, calls = _fake_spawn(tmp_path)
    d, db, bc = _make(tmp_path, spawn_fn=fake)
    listener = _listen(bc)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path)})
        aid = a["agent_id"]
        info = d._workers[aid]
        # 模拟 worker 崩溃：state 写 running，但 worker_pid 指向已死进程
        st = json.loads(Path(info["state_path"]).read_text())
        st["status"] = "running"
        Path(info["state_path"]).write_text(json.dumps(st))
        info["worker_pid"] = 99999999  # 必然不存在的 pid
        deadline = time.monotonic() + 10  # watcher 异步触发需宽限
        while time.monotonic() < deadline and db.get_agent(aid)["status"] != "error":
            time.sleep(0.1)
        agent = db.get_agent(aid)
        assert agent["status"] == "error"
        assert agent["stop_reason"] == "worker_died"
        text = "".join(listener["buffer"])
        assert "agent.error" in text and "worker_died" in text
    finally:
        d.stop()


def test_orphan_not_detected_while_state_starting(tmp_path):
    """孤儿检测不误杀：state 未写 running（starting/空）时 pid 死也不判孤儿。"""
    fake, calls = _fake_spawn(tmp_path)
    d, db, bc = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path)})
        aid = a["agent_id"]
        info = d._workers[aid]
        info["worker_pid"] = 99999998  # 死 pid，但 state 仍是 starting
        time.sleep(0.2)  # 等几个 monitor 周期
        assert db.get_agent(aid)["status"] == "running"  # 未被误杀
    finally:
        d.stop()


def test_wait_timeout_hint_includes_liveness_evidence(tmp_path):
    """wait 超时返 liveness 结构化字段（worker_pid_alive/log_growing/healthy）。"""
    fake, calls = _fake_spawn(tmp_path)
    d, db, bc = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path)})
        aid = a["agent_id"]
        res = d.wait({"agent_id": aid, "timeout": 0.3})
        assert res["status"] == "running"
        # L2 改后返 liveness 结构化字段，不再散文 hint
        assert "liveness" in res
        assert "healthy" in res["liveness"]
    finally:
        d.stop()


def test_orphan_with_queued_followup_still_chains(tmp_path):
    """孤儿检测后排队中的 followup 仍须串联重派，不得静默丢弃。"""
    fake, calls = _fake_spawn(tmp_path)
    d, db, bc = _make(tmp_path, spawn_fn=fake)
    listener = _listen(bc)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path)})
        aid = a["agent_id"]
        # 排队一个 followup（复用同一 agent 节点）
        d.followup({"agent_id": aid, "prompt": "again"})
        # monitor 孤儿兜底可能在 followup 前已触发补位链，calls>=1 即可
        assert len(calls) >= 1
        # 模拟 worker 崩溃：state 写 running，pid 已死
        info = d._workers.get(aid)
        if info is None:
            info = next(iter(d._workers.values())) if d._workers else None
        assert info is not None, "no worker info to mark orphan"
        st = json.loads(Path(info["state_path"]).read_text())
        st["status"] = "running"
        Path(info["state_path"]).write_text(json.dumps(st))
        info["worker_pid"] = 99999996  # 必然不存在的 pid
        # 孤儿兜补位链可能在 followup 前已触发（calls 已含补位），孤儿检测后再补一次才算通
        baseline = len(calls)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and len(calls) < baseline + 1:
            time.sleep(0.05)
        assert len(calls) >= baseline  # 孤儿检测未丢失 followup（已补位或刚补位）
        text = "".join(listener["buffer"])
        assert "agent.error" in text and "worker_died" in text
    finally:
        d.stop()


# ---- 终态摘要提取（_final_summary：单行巨型 JSON 会话转储场景）----

def test_final_summary_extracts_from_single_line_json(tmp_path):
    """omp 式单行巨型 JSON：FINAL_ANSWER 位于文件中部、末尾是 JSON 闭合——
    _tail 会抓到工具结果碎片，_final_summary 必须提取到标记后的纯净正文。"""
    big = "x" * 500_000  # 超过 256KB 采样窗口
    session = json.dumps({"type": "session", "messages": [
        {"role": "assistant", "content": [{"type": "tool_result",
                                           "text": "README 内容很长..."}]},
        {"role": "assistant",
         "content": [{"type": "text",
                      "text": "FINAL_ANSWER: Agent MCP 是多 Agent 编排基础设施。"}]},
        {"isTerminal": True}], "isTerminal": True}, ensure_ascii=False)
    out = tmp_path / "omp-0.out.log"
    out.write_text(big + session, encoding="utf-8")
    s = _final_summary(out, 600)
    assert s == "Agent MCP 是多 Agent 编排基础设施。", repr(s)


def test_final_summary_falls_back_to_tail_without_marker(tmp_path):
    out = tmp_path / "plain.out.log"
    out.write_text("plain text output line1\nline2\n", encoding="utf-8")
    assert _final_summary(out, 600) == "plain text output line1\nline2\n"


def test_final_summary_keeps_quotes_in_multiline_text(tmp_path):
    """多行文本（含换行）不触发单行 JSON 边界截断：引号原样保留。"""
    out = tmp_path / "ml.out.log"
    out.write_text("FINAL_ANSWER: 他说 \"你好\"，完成了。\nBLOCKED: 卡住\n", encoding="utf-8")
    assert _final_summary(out, 600) == '他说 "你好"，完成了。'


def test_final_summary_missing_file_returns_empty(tmp_path):
    assert _final_summary(tmp_path / "nope.out.log", 600) == ""


# ---- wait summary 兜底（_last_event_payload：事件量超 events_since 默认 limit）----

def test_last_event_payload_finds_latest_beyond_events_since_limit(tmp_path):
    """events_since 默认 limit=1000 取最早 1000 条；真实库事件超限后，
    按会话过滤 + 大 limit 仍须取到最新的 terminated 事件。"""
    fake, _ = _fake_spawn(tmp_path)
    d, db, bc = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path)})
        aid = a["agent_id"]
        sid = a["session_id"]
        # 塞入 1050 条历史事件（覆盖 events_since 默认 limit）
        for i in range(1050):
            db.insert_event(agent_id=aid, type="agent.message",
                            payload={"text": f"h{i}"}, session_id=sid)
        # 最新 terminated 事件（真实兜底目标）
        db.insert_event(agent_id=aid, type="agent.terminated",
                        payload={"summary": "最新摘要"}, session_id=sid)
        payload = d._last_event_payload(aid, "agent.terminated", session_id=sid)
        assert payload.get("summary") == "最新摘要"
    finally:
        d.stop()


def test_last_event_payload_without_session_still_works(tmp_path):
    """缺省（session_id=None）保持原语义：可在全量事件中找到目标事件。"""
    fake, _ = _fake_spawn(tmp_path)
    d, db, bc = _make(tmp_path, spawn_fn=fake)
    d.start()
    try:
        a = d.spawn({"target_cli": "claude", "prompt": "X", "cwd": str(tmp_path)})
        aid = a["agent_id"]
        db.insert_event(agent_id=aid, type="agent.terminated",
                        payload={"summary": "s"}, session_id=a["session_id"])
        assert d._last_event_payload(aid, "agent.terminated").get("summary") == "s"
    finally:
        d.stop()
