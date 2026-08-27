"""A5 生命周期闭环测试：queued 落库再水化、存活 worker 认领收尸、
_events 容量回收、策略引擎去热路径写盘。

核心场景是 daemon 重启模拟：同一个 SQLite 文件上重建 Dispatcher，
验证不丢任务、不留永久 running 记录——这是路线图 A5 的 DoD。
"""
import json
import os
import subprocess
import time
from pathlib import Path

import pytest

from agent_mcp.daemon_main import Dispatcher
from agent_mcp.db import DB
from agent_mcp.policies import PolicyEngine, PolicyEvent


class NoopWorker:
    def __init__(self):
        self.spawned = []

    def __call__(self, target_cli, **kwargs):
        self.spawned.append((target_cli, kwargs))
        return {"worker_pid": os.getpid(), "command_summary": "noop",
                "state_path": "", "out_path": "", "err_path": ""}


def make_dispatcher(db_path: Path, tmp_path: Path):
    db = DB(db_path)
    worker = NoopWorker()
    disp = Dispatcher(db=db, broadcaster=__import__(
        "agent_mcp.daemon_http", fromlist=["EventBroadcaster"]).EventBroadcaster(),
        state_dir=tmp_path / "state", spawn_fn=worker)
    return db, disp, worker


def _wait_for(predicate, timeout=5.0, interval=0.05):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return False


# ---- queued 落库与重启再水化 ----

def test_queued_agent_rehydrates_after_restart(tmp_path):
    db_path = tmp_path / "l.sqlite3"
    db, disp0, worker0 = make_dispatcher(db_path, tmp_path)
    # 第一代：spawn 被槽位限制排队（直接构造落库状态，等价于槽满时的产物）
    agent_id = db.insert_agent(parent_id=None, session_id="s1",
                               task_name="q1", cli="claude", cwd=str(tmp_path))
    db.set_status(agent_id, "queued")
    params = ["claude", "do things", str(tmp_path), {"permission_mode": "plan",
                                                     "session_id": "s1"}]
    db.set_pending_params(agent_id, json.dumps(params, ensure_ascii=False))
    db.close_idle() if hasattr(db, "close_idle") else None

    # 第二代（模拟 daemon 重启）：同库新建 Dispatcher 并恢复队列
    db2, disp1, worker1 = make_dispatcher(db_path, tmp_path)
    disp1._rehydrate_queue()

    assert len(worker1.spawned) == 1  # 有空槽，立即开跑
    assert worker1.spawned[0][0] == "claude"
    assert worker1.spawned[0][1]["prompt"] == "do things"
    row = db2.get_agent(agent_id)
    assert row["pending_params"] is None  # 开始运行即清掉落库副本


def test_queued_corrupted_params_marked_failed_not_stuck(tmp_path):
    db, disp, worker = make_dispatcher(tmp_path / "c.sqlite3", tmp_path)
    agent_id = db.insert_agent(parent_id=None, session_id="s2",
                               task_name="bad", cli="claude")
    db.set_status(agent_id, "queued")
    db.set_pending_params(agent_id, "{not-json")

    disp._rehydrate_queue()
    row = db.get_agent(agent_id)
    assert row["status"] == "error"
    assert row["stop_reason"] == "queued_params_corrupted"
    assert worker.spawned == []


# ---- 存活 worker 的认领与收尸 ----

def test_dead_worker_orphan_and_live_worker_adopted(tmp_path):
    db_path = tmp_path / "r.sqlite3"
    db, disp, worker = make_dispatcher(db_path, tmp_path)
    dead = db.insert_agent(parent_id=None, session_id="s3",
                           task_name="dead", cli="claude")
    db.set_status(dead, "running", pid=999999)  # 不存在的 pid

    live_proc = subprocess.Popen(
        ["python3", "-c", "import time; time.sleep(30)"])
    try:
        state_dir = tmp_path / "w"
        state_dir.mkdir()
        state_path = state_dir / "stub.json"
        out_path = state_dir / "stub.out"
        err_path = state_dir / "stub.err"
        out_path.write_text("")
        err_path.write_text("")
        state_path.write_text(json.dumps({"status": "running"}))
        live = db.insert_agent(parent_id=None, session_id="s3",
                               task_name="live", cli="claude")
        db.set_status(live, "running", pid=live_proc.pid)
        db.set_worker_info(live, json.dumps({
            "worker_pid": live_proc.pid, "state_path": str(state_path),
            "out_path": str(out_path), "err_path": str(err_path)}))

        disp._recover_orphans()

        # 死 pid：孤儿收尸（原 D2 行为保持）
        assert db.get_agent(dead)["status"] == "incomplete"
        # 活 pid：被认领（重建 info + 重挂 watcher）
        assert live in disp._workers and disp._workers[live].get("adopted") is True
        assert live in disp._watchers

        # 收尸闭环：worker 退出后认领 watcher 触发 _check_worker → 正常终态
        state_path.write_text(json.dumps({"status": "finished", "process_status": 0}))
        live_proc.kill()
        live_proc.wait(timeout=5)
        assert _wait_for(lambda: (
            db.get_agent(live) or {}).get("status") == "terminated"), \
            "adopted worker 未在退出后被收尸为 terminated"
    finally:
        if live_proc.poll() is None:
            live_proc.kill()


# ---- _events 容量回收 ----

def test_events_capped_evicting_only_signaled(tmp_path):
    db, disp, _ = make_dispatcher(tmp_path / "e.sqlite3", tmp_path)
    import threading
    with disp._lock:
        for i in range(600):
            ev = threading.Event()
            if i < 300:      # 前 300 个已 set（可淘汰）
                ev.set()
            disp._events[i] = ev
        disp._cap_events_locked()
        remaining = dict(disp._events)
    assert len(remaining) <= disp._EVENTS_CAP
    # 淘汰的全是已 set 条目；未 set 的必须保留
    assert all(not ev.is_set() for ev in list(remaining.values())[len(remaining) - 300:])


# ---- 策略引擎去热路径写盘 ----

def test_policy_engine_defers_disk_write_until_dirty_flush(tmp_path):
    eng = PolicyEngine(state_path=tmp_path / "policies.json")
    eng.evaluate(PolicyEvent("usage_delta", data={"cost": 0.01}))
    assert not (tmp_path / "policies.json").exists(), \
        "evaluate 后不得立即同步写盘（热路径）"

    assert eng.save_if_dirty() is True
    assert (tmp_path / "policies.json").exists()
    content = (tmp_path / "policies.json").read_text(encoding="utf-8")

    # 无新变更时不再重复写盘
    (tmp_path / "policies.json").write_text(content + " ")
    assert eng.save_if_dirty() is False
    assert (tmp_path / "policies.json").read_text(encoding="utf-8") == content + " "

    # 显式 save（配置变更路径）仍立即落盘并清脏标记
    eng.save()
    assert (tmp_path / "policies.json").read_text(encoding="utf-8") != content + " "
