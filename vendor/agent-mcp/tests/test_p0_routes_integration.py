"""P0 断线修复的路由级回归测试（v3.0 里程碑1，路线图 A1 DoD）。

背景：f7a948e 的 mailbox/consensus/audit 模块单测全绿但 daemon 接线断裂
（调用不存在的方法/错误 kwarg/错误返回值处理），暴露"缺 daemon 级集成层"。

本文件的"真实链路"= 真实 DB + 真实 Dispatcher + daemon_http._API_METHODS
真实路由表解析（与 POST 处理器同一张表、同一个 getattr 反射约定）。
HTTP socket 传输层由 tests/test_web_api.py 的真实 ThreadingHTTPServer 覆盖，
此处不再起端口（安全约束：避免在测试中构造动态网络目标）。

覆盖：
- mailbox_send/fetch、consensus_vote 三路由端到端（含 payload 信封与错误路径）
- 审计结算 _settle_workspace_audit：真实快照比对入库 + 失败留痕 agent.audit_failed
- 容器沙箱命令组装（kwarg/mount_cwd/network_disabled 回归）
- worktree git 命令绑定 -C base_dir（remove 路径）
- orchestrate_task schema 放行 max_auto_refine/refine_prompt
"""
import json
from pathlib import Path

import pytest

import agent_mcp.daemon_main as daemon_main
from agent_mcp.audit import snapshot_workspace
from agent_mcp.daemon_http import _API_METHODS, EventBroadcaster
from agent_mcp.daemon_main import Dispatcher
from agent_mcp.db import DB
from agent_mcp.orchestrator import OrchestratedTask, Orchestrator


class NoopWorker:
    """可注入的假 spawn：不启动任何进程。"""

    def __init__(self):
        self.spawned = []

    def __call__(self, target_cli, **kwargs):
        self.spawned.append((target_cli, kwargs))
        return {"worker_pid": 0, "command_summary": "noop",
                "state_path": "", "out_path": "", "err_path": ""}


@pytest.fixture()
def env(tmp_path):
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    db = DB(tmp_path / "test.sqlite3")
    worker = NoopWorker()
    dispatcher = Dispatcher(db=db, broadcaster=EventBroadcaster(),
                            state_dir=state_dir, spawn_fn=worker)
    yield {"db": db, "dispatcher": dispatcher}


def call_route(env, path: str, body: dict):
    """按 daemon_http POST 处理器的同款约定调用路由：
    路径必须存在于 _API_METHODS，方法以 getattr(dispatcher, name) 反射取得；
    ValueError → 400，其余异常 → 500（与 Handler._handle_post 对齐）。"""
    method = _API_METHODS.get(path)
    assert method is not None, f"route not registered: {path}"
    try:
        return 200, getattr(env["dispatcher"], method)(body)
    except ValueError as exc:
        return 400, {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        return 500, {"error": str(exc)}


def post(env, path: str, body: dict) -> tuple[int, dict]:
    status, result = call_route(env, path, body)
    if status == 200 and not isinstance(result, dict):
        raise AssertionError(f"non-dict route result: {result!r}")
    if status != 200:
        result = {"error": str(result.get("error", ""))}
    return status, result


# ---- mailbox / consensus：路由表 → 真实 Dispatcher 端到端 ----

def test_mailbox_routes_are_registered():
    # 防路由表漂移：三个新工具必须注册在 POST 反射表中
    assert _API_METHODS["/api/mailbox/send"] == "mailbox_send"
    assert _API_METHODS["/api/mailbox/fetch"] == "mailbox_fetch"
    assert _API_METHODS["/api/consensus/vote"] == "consensus_vote"
    for m in ("mailbox_send", "mailbox_fetch", "consensus_vote"):
        assert callable(getattr(Dispatcher, m)), f"Dispatcher.{m} missing"


def add_agent(env, session_id="s-default", task="m"):
    """A6 身份校验要求 from_agent_id 真实存在且同会话。"""
    return env["db"].insert_agent(parent_id=None, session_id=session_id,
                                  task_name=task, cli="claude")


def test_mailbox_send_fetch_roundtrip_over_route(env):
    sender = add_agent(env, "s1", "sender")
    receiver = add_agent(env, "s1", "receiver")
    status, sent = post(env, "/api/mailbox/send", {
        "team": "t1", "from_agent_id": sender, "to_agent_id": receiver,
        "session_id": "s1",
        "message": "hello", "payload": {"plan": "A"},
    })
    assert status == 200 and sent["status"] == "sent"

    status, fetched = post(env, "/api/mailbox/fetch",
                           {"team": "t1", "agent_id": receiver})
    assert status == 200
    msgs = fetched["messages"]
    assert len(msgs) == 1
    envelope = json.loads(msgs[0]["message"])
    assert envelope["text"] == "hello"
    assert envelope["payload"] == {"plan": "A"}

    # 未读过滤不影响 unread_only=False 的全量读取
    _, again = post(env, "/api/mailbox/fetch",
                    {"team": "t1", "agent_id": receiver, "unread_only": False})
    assert len(again["messages"]) == 1


def test_mailbox_broadcast_and_inbox_delivery(env):
    sender = add_agent(env, "s2", "bcast")
    listeners = [add_agent(env, "s2", f"l{i}") for i in (1, 2)]
    post(env, "/api/mailbox/send", {
        "team": "t2", "from_agent_id": sender, "session_id": "s2",
        "message": "to all"})
    for aid in listeners:
        _, got = post(env, "/api/mailbox/fetch", {"team": "t2", "agent_id": aid})
        assert [m["message"] for m in got["messages"]] == ["to all"]


def test_mailbox_fetch_requires_agent_id(env):
    status, body = post(env, "/api/mailbox/fetch", {"team": "t9"})
    assert status == 400 and "agent_id" in body["error"]


def test_consensus_propose_vote_tally_over_route(env):
    voters = [add_agent(env, "c-sess", f"v{i}") for i in (1, 2, 3)]
    sess = "c-sess"
    _, prop = post(env, "/api/consensus/vote", {
        "team": "c1", "from_agent_id": voters[0], "session_id": sess,
        "action": "propose", "proposal": "use sqlite wal"})
    assert prop["status"] == "proposed"

    votes = []
    for voter, choice in zip(voters, (True, True, False)):
        body = {"team": "c1", "from_agent_id": voter, "session_id": sess,
                "action": "vote", "vote": choice}
        if choice is False:
            body["reason"] = "risky"
        _, v = post(env, "/api/consensus/vote", body)
        votes.append(v)
    assert all(v["status"] == "voted" for v in votes)

    _, tally = post(env, "/api/consensus/vote", {"team": "c1", "action": "tally"})
    t = tally["tally"]
    assert t["approve"] == 2 and t["reject"] == 1 and t["total"] == 3
    assert t["passed"] is True


# ---- audit 结算链：真实快照 → record_file_diff；失败留痕事件 ----

def test_audit_settlement_records_file_diffs(env):
    ws = Path(env["db"].path).parent / "ws"
    ws.mkdir()
    (ws / "a.txt").write_text("v1")
    initial_snap = snapshot_workspace(str(ws))
    # 模拟 worker 改动：修改 a.txt、新增 b.txt
    (ws / "a.txt").write_text("v2-longer-content")
    (ws / "b.txt").write_text("new file")

    agent_id = env["db"].insert_agent(parent_id=None, session_id="s1",
                                      task_name="audit-case", cli="claude",
                                      cwd=str(ws))
    env["dispatcher"]._settle_workspace_audit(
        agent_id, {"initial_snapshot": initial_snap, "cwd": str(ws)})

    diffs = {d["file_path"]: d["change_type"]
             for d in env["db"].get_file_diffs(agent_id=agent_id)}
    assert diffs == {"a.txt": "modified", "b.txt": "added"}
    row = next(d for d in env["db"].get_file_diffs(agent_id=agent_id)
               if d["file_path"] == "a.txt")
    assert row["session_id"] == "s1"


def test_audit_failure_emits_audit_failed_event(env, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("diff exploded")

    monkeypatch.setattr(daemon_main, "compute_workspace_diff", boom)
    ws = Path(env["db"].path).parent / "ws2"
    ws.mkdir()
    (ws / "x.txt").write_text("v1")
    snap = snapshot_workspace(str(ws))
    agent_id = env["db"].insert_agent(parent_id=None, session_id="s2",
                                      task_name="audit-fail", cli="claude",
                                      cwd=str(ws))
    env["dispatcher"]._settle_workspace_audit(
        agent_id, {"initial_snapshot": snap, "cwd": str(ws)})

    events = env["db"].events_since(0)
    failed = [e for e in events if e["type"] == "agent.audit_failed"]
    assert len(failed) == 1
    assert "diff exploded" in failed[0]["payload"]["error"]


def test_audit_skips_when_no_initial_snapshot(env):
    agent_id = env["db"].insert_agent(parent_id=None, session_id="s3",
                                      task_name="no-snap", cli="claude")
    # 无 initial_snapshot 时静默跳过，不产生 diff 也不产生失败事件
    env["dispatcher"]._settle_workspace_audit(
        agent_id, {"cwd": str(Path(env["db"].path).parent)})
    assert env["db"].get_file_diffs(agent_id=agent_id) == []
    assert all(e["type"] != "agent.audit_failed"
               for e in env["db"].events_since(0))


# ---- 容器沙箱命令组装（回归 network=/mount_cwd 两处断点） ----

class _StubAdapter:
    cli_name = "stub"

    def binary(self):
        return "/bin/echo"

    def build_command(self, *, prompt, cwd, model=None, permission_mode="plan",
                      max_turns=8, resume=None):
        return ["/bin/echo", prompt]


def test_container_sandbox_command_assembly(monkeypatch, tmp_path):
    import agent_mcp.dispatch as dispatch

    monkeypatch.setattr(dispatch, "get_adapter", lambda name: _StubAdapter())

    class FakeProc:
        pid = 4242

    monkeypatch.setattr(dispatch, "spawn_detached",
                        lambda cmd, *, env=None: FakeProc())
    cwd = tmp_path / "work"
    cwd.mkdir()

    result = dispatch.spawn_cli_worker(
        target_cli="stub", prompt="hi", cwd=str(cwd), permission_mode="plan",
        max_turns=8, resume=None, state_dir=tmp_path / "state", timeout_seconds=30,
        sandbox_container="python:3.12-slim", sandbox_network="none")

    cmd = result["command_summary"].split(" ")
    assert "docker" in cmd and "--network" in cmd and "none" in cmd
    # mount_cwd 修复：宿主工作区必须被挂载进容器（plan 只读 → ro）
    assert f"-v {cwd.resolve()}:/workspace:ro" in result["command_summary"]
    assert "--read-only" in cmd
    assert cmd[-3:] == ["python:3.12-slim", "/bin/echo", "hi"]

    # 非只读模式：rw 挂载、无 --read-only
    result2 = dispatch.spawn_cli_worker(
        target_cli="stub", prompt="yo", cwd=str(cwd), permission_mode="fullAccess",
        max_turns=8, resume=None, state_dir=tmp_path / "state", timeout_seconds=30,
        sandbox_container="python:3.12-slim")
    assert f"{cwd.resolve()}:/workspace:rw" in result2["command_summary"]
    assert "--read-only" not in result2["command_summary"].split(" ")


def test_daemon_wires_sandbox_image_env(monkeypatch, tmp_path):
    """AGENT_MCP_SANDBOX_IMAGE 设置后 spawn 选项携带容器参数（链路可达性）。"""
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    db = DB(tmp_path / "w.sqlite3")
    worker = NoopWorker()
    disp = Dispatcher(db=db, broadcaster=EventBroadcaster(),
                      state_dir=state_dir, spawn_fn=worker)
    monkeypatch.setenv("AGENT_MCP_SANDBOX_IMAGE", "python:3.12-slim")
    disp._run_worker(1, "claude", "p", str(tmp_path),
                     {"target_cli": "claude", "prompt": "p", "session_id": "sx"})
    assert worker.spawned[0][1]["sandbox_container"] == "python:3.12-slim"


# ---- worktree 绑定正确仓库 + schema 漂移放行 ----

def test_worktree_remove_binds_base_dir():
    git_calls: list[list[str]] = []

    def fake_git(cmd):
        git_calls.append(cmd)
        return 0, "ok"

    orch = Orchestrator(spawner=lambda *a: 0, waiter=lambda *a: {},
                        git_runner=fake_git, base_dir="/repo")
    task = OrchestratedTask(task_id="w9", prompt="p", worktree=True,
                            worktree_path="/repo/.worktrees/w9")
    orch._cleanup_worktree(task)
    assert git_calls == [["git", "-C", "/repo", "worktree", "remove", "--force",
                          "/repo/.worktrees/w9"]]


def test_orchestrate_schema_allows_refine_fields():
    from mcp_server import TOOLS
    schema = next(t for t in TOOLS if t["name"] == "orchestrate_task")
    items = schema["inputSchema"]["properties"]["tasks"]["items"]
    assert "max_auto_refine" in items["properties"]
    assert "refine_prompt" in items["properties"]
    # additionalProperties:false 下这两个字段必须显式声明才发得出去
    assert items["additionalProperties"] is False
