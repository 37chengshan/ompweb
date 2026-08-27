import sqlite3
from concurrent.futures import ThreadPoolExecutor

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

def test_events_are_sequence_and_delta_not_persisted(tmp_path):
    db = DB(tmp_path / "test.db")
    e1 = db.insert_event(agent_id=1, type="agent.message", payload={"text": "x"}, session_id="s1")
    e2 = db.insert_event(agent_id=1, type="agent.message_delta", payload={"d": "x"}, session_id="s1")
    assert e1 == 1
    assert e2 is None  # delta 不落库
    rows = db.events_since(0, session_id="s1")
    assert len(rows) == 1 and rows[0]["type"] == "agent.message"

def test_usage_projection_and_upsert(tmp_path):
    db = DB(tmp_path / "test.db")
    db.upsert_usage(agent_id=1, model="m1", input_tokens=10, output_tokens=5,
                    cache_creation=0, cache_read=0, cost_usd=0.1)
    db.upsert_usage(agent_id=1, model="m1", input_tokens=3, output_tokens=1,
                    cache_creation=0, cache_read=0, cost_usd=0.05)  # 同模型再上报 → 覆盖
    total = db.usage_total(agent_id=1)
    assert total["input_tokens"] == 3 and total["cost_usd"] == 0.05

def test_session_scoping(tmp_path):
    db = DB(tmp_path / "test.db")
    db.insert_agent(parent_id=None, session_id="s1", task_name="/root", cli="c", cwd=".")
    db.insert_agent(parent_id=None, session_id="s2", task_name="/root", cli="c", cwd=".")
    assert len(db.agents_by_session("s1")) == 1
    assert len(db.agents_by_session(None)) == 2

def test_messages_retention_limit(tmp_path):
    db = DB(tmp_path / "test.db", max_messages_per_agent=3)
    for i in range(5):
        db.insert_message(agent_id=1, role="assistant", content=f"msg{i}")
    msgs = db.messages_for(1)
    assert len(msgs) == 3
    assert msgs[0]["content"] == "msg2"  # 只保留最近 3 条


def test_events_by_agents_per_agent_limit(tmp_path):
    db = DB(tmp_path / "test.db")
    for i in range(5):
        db.insert_event(agent_id=1, type="agent.message", payload={"i": i}, session_id="s1")
    for i in range(3):
        db.insert_event(agent_id=2, type="agent.message", payload={"i": i}, session_id="s1")
    rows = db.events_by_agents([1, 2], per_agent_limit=2)
    assert [e["seq"] for e in rows] == [4, 5, 7, 8]  # 每 agent 最近 2 条，合并后按 seq 升序
    assert all(e["agent_id"] in (1, 2) and isinstance(e["payload"], dict) for e in rows)
    rows0 = db.events_by_agents([1, 2], per_agent_limit=0)
    assert rows0 == []


def test_busy_timeout_pragma_set(tmp_path):
    db = DB(tmp_path / "test.db")
    # F2 threading.local 后初始连接是 _init_conn；busy_timeout 应在其上设置
    assert db._init_conn.execute("PRAGMA busy_timeout").fetchone()[0] == 10000


def test_retention_cleanup_is_low_frequency(tmp_path):
    db = DB(tmp_path / "test.db", max_events=5, retain_interval=3600)
    for i in range(10):
        db.insert_event(agent_id=1, type="agent.message", payload={"i": i}, session_id="s")
    assert len(db.events_since(0)) > 5  # 高频插入不立即触发清理
    db2 = DB(tmp_path / "test.db", max_events=5, retain_interval=0)
    db2.insert_event(agent_id=1, type="agent.message", payload={"i": 99}, session_id="s")
    assert len(db2.events_since(0)) <= 6  # interval=0 时仍保留清理能力


def test_shared_connection_serializes_concurrent_reads_and_writes(tmp_path):
    """HTTP threads and the monitor may share one DB object without concurrent sqlite use."""
    db = DB(tmp_path / "test.db", retain_interval=3600)
    aid = db.insert_agent(
        parent_id=None,
        session_id="s",
        task_name="/root",
        cli="atomcode",
        cwd=str(tmp_path),
    )

    def exercise(worker: int) -> None:
        for i in range(50):
            db.insert_event(
                agent_id=aid,
                type="agent.message",
                payload={"worker": worker, "i": i},
                session_id="s",
            )
            assert db.get_agent(aid)["id"] == aid
            assert db.agents_by_session("s")[0]["id"] == aid
            db.messages_for(aid, size=1)
            db.usage_total(aid)
            db.max_seq()

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(exercise, worker) for worker in range(8)]
        for future in futures:
            future.result(timeout=10)

    assert db.max_seq() == 400


def test_touch_activity_updates_updated_at_without_status(tmp_path):
    db = DB(tmp_path / "test.db")
    aid = db.insert_agent(parent_id=None, session_id="s1", task_name="/root",
                          cli="claude", model="x", cwd=str(tmp_path))
    db.set_status(aid, "running")
    before = db.get_agent(aid)
    db.touch_activity(aid)
    after = db.get_agent(aid)
    assert after["status"] == "running"  # 状态机不动
    assert after["updated_at"] >= before["updated_at"]
