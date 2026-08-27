"""T14 集成冒烟：真实进程端到端（daemon 子进程 + MCP stdio 子进程 + 真实 CLI）。

覆盖设计文档 §8 验收：任务池真实派发（claude）、daemon HTTP/SSE/网页、
MCP 薄层全链路、中断/重启稳定性、常驻内存。
标记 @pytest.mark.integration（pytest.ini 已注册）；真实 CLI 用例在
claude 二进制缺失时 skipif 跳过。运行方式：
    python3 -m pytest tests/test_integration.py -v
"""
import json
import os
import queue
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

import pytest

import mcp_server
from agent_mcp.cli_adapters import ClaudeAdapter

ROOT = Path(__file__).resolve().parent.parent
DAEMON_MAIN = ROOT / "agent_mcp" / "daemon_main.py"
MCP_SERVER = ROOT / "mcp_server.py"
WEB_ROOT = ROOT / "web"

# HEARTBEAT_SECONDS=15（daemon_http），心跳用例留 10s 余量
PING_WINDOW = 25
LONG_PROMPT = ("请编写一个完整的 Python 计算器程序：包含至少 5 个类、"
               "每个类至少 40 行带中文注释的实现，并编写配套单元测试。")
SHORT_PROMPT = "回复 OK"

NO_CLAUDE = ClaudeAdapter().binary() is None
NO_CLAUDE_REASON = "claude CLI not installed"

MCP_TOOL_NAMES = ["spawn_agent", "send_message", "steer_agent", "followup_task",
                  "wait_agent", "interrupt_agent", "list_agents",
                  "get_agent_activity", "get_token_usage", "estimate_complexity",
                  "memory_store", "memory_recall"]

# v2.2.0 起：未声明 capability 的 client 默认发现全量 16 工具（legacy/2025-11-25
# 客户端不发送 _meta extensions——DSH 全量可见）；仅 2026-07-28 客户端显式声明
# io.modelcontextprotocol/tools.used 时才按声明裁剪（通用四件常驻）。

# tools/list 的 _meta capability 声明（2026-07-28 扩展约定），按声明保留对应工具
FULL_TOOLS_META = {
    "_meta": {
        "io.modelcontextprotocol/clientCapabilities": {
            "extensions": {
                "io.modelcontextprotocol/tools": {"used": MCP_TOOL_NAMES}
            }
        }
    }
}


# ---- 工具函数 ----

def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# 受控请求（SSRF 约束）：host/port 走独立参数、path 为以 / 开头的字面量，
# 不构造任何 URL 字符串。base 参数语义为 daemon 端口号。
def _wait_health(port: int, timeout: float = 10.0) -> None:
    import http.client
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
            conn.request("GET", "/health")
            ok = conn.getresponse().status == 200
            conn.close()
            if ok:
                return
        except Exception:
            pass
        time.sleep(0.2)
    raise RuntimeError(f"daemon not healthy at 127.0.0.1:{port} within {timeout:.0f}s")


def _post(port: int, token: str, path: str, payload: dict) -> dict:
    import http.client
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=60)
    conn.request("POST", path,
                 body=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                 headers={"X-Auth-Token": token,
                          "Content-Type": "application/json"})
    resp = conn.getresponse()
    body = json.loads(resp.read())
    conn.close()
    return body


def _get_json(port: int, path: str) -> dict:
    import http.client
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    conn.request("GET", path)
    resp = conn.getresponse()
    body = json.loads(resp.read())
    conn.close()
    return body


def _start_daemon(state_dir: Path, port: int) -> subprocess.Popen:
    err_log = state_dir.parent / "daemon.err.log"
    return subprocess.Popen(
        [sys.executable, str(DAEMON_MAIN), "--port", str(port),
         "--state-dir", str(state_dir), "--web-root", str(WEB_ROOT)],
        stdout=subprocess.DEVNULL, stderr=err_log.open("w"))


# ---- fixtures ----

@pytest.fixture()
def daemon(tmp_path):
    """真实 daemon 子进程（随机端口 + 独立 state-dir + 项目 web/）。"""
    from agent_mcp.dispatch import terminate_process_tree
    port = _free_port()
    state_dir = tmp_path / "state"
    proc = _start_daemon(state_dir, port)
    base = port  # 受控目标：仅回环端口号，URL 由 helper 按字面量路径构造
    try:
        _wait_health(base)
    except Exception:
        terminate_process_tree(proc.pid)
        proc.wait(timeout=5)
        raise
    token = json.loads((state_dir / "daemon.json").read_text(encoding="utf-8"))["token"]
    yield {"base": base, "token": token, "state_dir": state_dir, "pid": proc.pid,
           "proc": proc, "cwd": str(tmp_path)}
    terminate_process_tree(proc.pid)
    proc.wait(timeout=5)


def _sse_reader(port: int, q: queue.Queue, ready: threading.Event | None = None) -> None:
    """后台线程读 SSE 行到队列；EOF/异常投递 None 哨兵。
    ready（可选）：HTTP 响应头返回（服务器已注册 SSE client）后 set。"""
    import http.client
    try:
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=60)
        conn.request("GET", "/events")
        resp = conn.getresponse()
        if ready is not None:
            ready.set()
        while True:
            line = resp.fp.readline()
            if not line:
                break
            q.put(line.decode("utf-8", "replace").rstrip("\n"))
    except Exception:
        q.put(None)
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _collect_sse(q: queue.Queue, needed: list[str], timeout: float = 60.0) -> list[dict]:
    """从 SSE 队列收 data 事件直到 needed 类型全出现。"""
    events: list[dict] = []
    seen: set[str] = set()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline and not set(needed) <= seen:
        try:
            line = q.get(timeout=min(5.0, deadline - time.monotonic()))
        except queue.Empty:
            continue  # 单次等待超时但未到总 deadline，继续等
        if line is None:
            break
        if line.startswith("data: "):
            ev = json.loads(line[len("data: "):])
            events.append(ev)
            seen.add(ev.get("type", ""))
    return events


@pytest.fixture()
def mcp_proc(tmp_path):
    """MCP 薄层子进程（AGENT_MCP_PORT + CODEX_HOME 隔离，不碰真实 ~/.codex）。

    薄层 ensure_daemon 会自拉真实 daemon 子进程；teardown 一并清理。
    """
    from agent_mcp.dispatch import terminate_process_tree
    port = _free_port()
    codex_home = tmp_path / "codex-home"
    env = dict(os.environ, AGENT_MCP_PORT=str(port), CODEX_HOME=str(codex_home))
    proc = subprocess.Popen([sys.executable, str(MCP_SERVER)],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            env=env, text=True, bufsize=1)
    q: queue.Queue = queue.Queue()
    threading.Thread(target=_stdout_reader, args=(proc.stdout, q), daemon=True).start()
    yield {"proc": proc, "q": q, "codex_home": codex_home, "cwd": str(tmp_path)}
    try:
        proc.stdin.close()
        proc.wait(timeout=5)
    except Exception:
        proc.kill()
    lock = codex_home / "agent-mcp" / "daemon.lock"
    try:
        pid = json.loads(lock.read_text(encoding="utf-8"))["pid"]
        terminate_process_tree(pid)
    except Exception:
        pass


def _stdout_reader(stream, q: queue.Queue) -> None:
    for line in stream:
        q.put(line.rstrip("\n"))
    q.put(None)


def _rpc(proc: subprocess.Popen, q: queue.Queue, request: dict,
         timeout: float = 60.0) -> dict:
    proc.stdin.write(json.dumps(request) + "\n")
    proc.stdin.flush()
    line = q.get(timeout=timeout)
    assert line is not None, "MCP 子进程 stdout 提前 EOF"
    return json.loads(line)


# ---- daemon HTTP / SSE / 网页 ----

@pytest.mark.integration
def test_daemon_health_and_snapshot_structure(daemon):
    body = _get_json(daemon["base"], "/health")
    assert body["ok"] is True
    snap = _get_json(daemon["base"], "/api/snapshot")
    assert set(snap) == {"agents", "events", "usage", "last_seq"}
    assert set(snap["usage"]) == {"totals", "per_agent"}
    assert snap["last_seq"] == (snap["events"][-1]["seq"] if snap["events"] else 0)


@pytest.mark.integration
def test_daemon_serves_web_index(daemon):
    import http.client as _hc
    _conn = _hc.HTTPConnection("127.0.0.1", daemon["base"], timeout=10)
    _conn.request("GET", "/")
    resp = _conn.getresponse()
    assert resp.status == 200
    assert "text/html" in resp.headers["Content-Type"]
    body = resp.read().decode("utf-8")
    _conn.close()
    assert "Agent MCP" in body and 'id="map-pane"' in body


@pytest.mark.integration
def test_daemon_sse_receives_heartbeat(daemon):
    """真实 SSE 连接在 HEARTBEAT_SECONDS(15s) 窗口内收到 : ping。"""
    q: queue.Queue = queue.Queue()
    threading.Thread(target=_sse_reader, args=(daemon["base"], q), daemon=True).start()
    deadline = time.monotonic() + PING_WINDOW
    saw_ping = False
    while time.monotonic() < deadline:
        try:
            line = q.get(timeout=min(5.0, deadline - time.monotonic()))
        except queue.Empty:
            continue  # 单次等待超时但未到总 deadline，继续等
        if line == ": ping":
            saw_ping = True
            break
    assert saw_ping, f"{PING_WINDOW}s 内未收到 SSE 心跳"


@pytest.mark.integration
def test_daemon_sse_streams_live_spawn_events(daemon):
    """SSE 连接后 spawn 真实任务，直播流收到 spawned → running → terminated。"""
    q: queue.Queue = queue.Queue()
    ready: threading.Event = threading.Event()
    threading.Thread(target=_sse_reader, args=(daemon["base"], q, ready),
                     daemon=True).start()
    # 连接就绪（服务器已注册 SSE client）再 spawn，避免 spawned 广播早于连接建立而丢失
    assert ready.wait(5), "SSE 连接 5s 内未建立"
    r = _post(daemon["base"], daemon["token"], "/api/agents/spawn",
              {"target_cli": "claude", "prompt": SHORT_PROMPT,
               "cwd": daemon["cwd"], "max_turns": 1, "session_id": "sse-test"})
    aid = r["agent_id"]
    events = _collect_sse(q, ["agent.spawned", "agent.running", "agent.terminated"])
    types = [e["type"] for e in events]
    assert types[0] == "agent.spawned"
    assert "agent.running" in types and "agent.terminated" in types
    assert all(e["agent_id"] == aid for e in events)


# ---- daemon 真实 CLI 任务（claude） ----

@pytest.mark.integration
@pytest.mark.skipif(NO_CLAUDE, reason=NO_CLAUDE_REASON)
def test_daemon_claude_spawn_wait_end_to_end(daemon):
    """spawn → wait 全链路：terminated/end_turn + 事件序列 + usage 落库。"""
    r = _post(daemon["base"], daemon["token"], "/api/agents/spawn",
              {"target_cli": "claude", "prompt": SHORT_PROMPT,
               "cwd": daemon["cwd"], "max_turns": 1, "session_id": "e2e-test"})
    assert r["status"] == "running"
    aid = r["agent_id"]
    done = _post(daemon["base"], daemon["token"], "/api/agents/wait",
                 {"agent_id": aid, "timeout": 30})
    assert done["status"] == "terminated"
    assert done["stop_reason"] == "end_turn"

    snap = _get_json(daemon["base"], "/api/snapshot?session_id=e2e-test")
    agents = [a for a in snap["agents"] if a["id"] == aid]
    assert agents and agents[0]["status"] == "terminated"
    types = [e["type"] for e in snap["events"] if e["agent_id"] == aid]
    assert types[0] == "agent.spawned"
    assert "agent.running" in types
    assert "agent.terminated" in types
    assert any(t in ("agent.message", "agent.usage") for t in types)
    assert snap["usage"]["totals"]["input_tokens"] > 0


@pytest.mark.integration
@pytest.mark.skipif(NO_CLAUDE, reason=NO_CLAUDE_REASON)
def test_daemon_interrupt_real_task_cancelled(daemon):
    """中断真实运行中的任务：进程树终止 + cancelled/interrupted 落库。"""
    r = _post(daemon["base"], daemon["token"], "/api/agents/spawn",
              {"target_cli": "claude", "prompt": LONG_PROMPT,
               "cwd": daemon["cwd"], "max_turns": 50, "session_id": "int-test"})
    aid = r["agent_id"]
    time.sleep(2)  # 让任务进入运行态
    out = _post(daemon["base"], daemon["token"], "/api/agents/interrupt",
                {"agent_id": aid})
    assert out["status"] == "cancelled"
    assert out["stop_reason"] == "interrupted"
    snap = _get_json(daemon["base"], "/api/snapshot?session_id=int-test")
    agent = next(a for a in snap["agents"] if a["id"] == aid)
    assert agent["status"] == "cancelled"
    assert agent["stop_reason"] == "interrupted"


@pytest.mark.integration
@pytest.mark.skipif(NO_CLAUDE, reason=NO_CLAUDE_REASON)
def test_daemon_restart_preserves_history(daemon):
    """daemon 重启后 snapshot 仍有历史：同 state-dir 重起，agents/usage 保留。"""
    from agent_mcp.dispatch import terminate_process_tree
    r = _post(daemon["base"], daemon["token"], "/api/agents/spawn",
              {"target_cli": "claude", "prompt": SHORT_PROMPT,
               "cwd": daemon["cwd"], "max_turns": 1, "session_id": "restart-test"})
    aid = r["agent_id"]
    done = _post(daemon["base"], daemon["token"], "/api/agents/wait",
                 {"agent_id": aid, "timeout": 30})
    assert done["status"] == "terminated"

    terminate_process_tree(daemon["pid"])
    daemon["proc"].wait(timeout=5)
    port2 = _free_port()
    proc2 = _start_daemon(daemon["state_dir"], port2)
    try:
        _wait_health(port2)
        snap = _get_json(port2, "/api/snapshot?session_id=restart-test")
        agents = [a for a in snap["agents"] if a["id"] == aid]
        assert agents and agents[0]["status"] == "terminated"
        assert snap["usage"]["totals"]["input_tokens"] > 0
    finally:
        terminate_process_tree(proc2.pid)
        proc2.wait(timeout=5)


# ---- MCP stdio 端到端（薄层自动拉起 daemon） ----

@pytest.mark.integration
@pytest.mark.skipif(NO_CLAUDE, reason=NO_CLAUDE_REASON)
def test_mcp_stdio_end_to_end(mcp_proc):
    """真实 stdio 会话：initialize → tools/list → spawn → interrupt → wait → usage。"""
    proc, q = mcp_proc["proc"], mcp_proc["q"]

    init = _rpc(proc, q, {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                          "params": {"protocolVersion": "2025-03-26",
                                     "clientInfo": {"name": "codex", "version": "1.0"}}})
    assert init["result"]["serverInfo"] == {"name": "agent-mcp", "version": mcp_server.SERVER_VERSION}
    assert init["result"]["protocolVersion"] == "2025-03-26"

    tools = _rpc(proc, q, {"jsonrpc": "2.0", "id": 2, "method": "tools/list",
                           "params": FULL_TOOLS_META})
    names = [t["name"] for t in tools["result"]["tools"]]
    assert names == MCP_TOOL_NAMES

    # 真实中断路径：长任务 spawn → interrupt → cancelled
    spawn1 = _rpc(proc, q, {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                            "params": {"name": "spawn_agent", "arguments": {
                                "target_cli": "claude", "prompt": LONG_PROMPT,
                                "cwd": mcp_proc["cwd"], "max_turns": 50}}},
                  timeout=90)
    body = json.loads(spawn1["result"]["content"][0]["text"])
    assert body["status"] == "running"
    aid = body["agent_id"]
    time.sleep(2)
    intr = _rpc(proc, q, {"jsonrpc": "2.0", "id": 4, "method": "tools/call",
                          "params": {"name": "interrupt_agent",
                                     "arguments": {"agent_id": aid}}})
    assert intr["result"]["isError"] is False
    assert json.loads(intr["result"]["content"][0]["text"])["status"] == "cancelled"

    # 完整等待路径：短任务 spawn → wait → terminated + usage
    spawn2 = _rpc(proc, q, {"jsonrpc": "2.0", "id": 5, "method": "tools/call",
                            "params": {"name": "spawn_agent", "arguments": {
                                "target_cli": "claude", "prompt": SHORT_PROMPT,
                                "cwd": mcp_proc["cwd"], "max_turns": 1}}})
    aid2 = json.loads(spawn2["result"]["content"][0]["text"])["agent_id"]
    # L2 契约：wait_agent 是"短阻塞"——超时返回 running + liveness 存活证据，
    # 提示客户端"call wait_agent again to keep waiting"。真实 claude 任务在共享
    # model 负载下可能超过单次 30s 窗口，按契约重试直到终态（总预算 120s）。
    rid = 6
    wbody = {}
    wait_deadline = time.monotonic() + 120
    while time.monotonic() < wait_deadline:
        waited = _rpc(proc, q, {"jsonrpc": "2.0", "id": rid, "method": "tools/call",
                                "params": {"name": "wait_agent",
                                           "arguments": {"agent_id": aid2,
                                                         "timeout": 30}}})
        rid += 1
        wbody = json.loads(waited["result"]["content"][0]["text"])
        if wbody["status"] in ("terminated", "error", "cancelled", "incomplete"):
            break
        assert wbody["status"] == "running", wbody  # 未知状态直接失败
    assert wbody["status"] == "terminated", wbody
    assert wbody["stop_reason"] == "end_turn"

    # 会话内 list / usage 查询
    listed = _rpc(proc, q, {"jsonrpc": "2.0", "id": rid, "method": "tools/call",
                            "params": {"name": "list_agents", "arguments": {}}})
    lbodies = [a["id"] for a in
               json.loads(listed["result"]["content"][0]["text"])["agents"]]
    assert aid in lbodies and aid2 in lbodies
    used = _rpc(proc, q, {"jsonrpc": "2.0", "id": rid + 1, "method": "tools/call",
                          "params": {"name": "get_token_usage",
                                     "arguments": {"agent_id": aid2}}})
    ub = json.loads(used["result"]["content"][0]["text"])
    assert ub["input_tokens"] > 0 and ub["estimated"] is True


@pytest.mark.integration
def test_mcp_tools_full_for_undeclared_client(mcp_proc):
    """v2.2.0 契约：未声明 capability 的 client 在 tools/list 发现全量 16 工具
    （legacy/2025-11-25 客户端不发送 _meta extensions，默认全量——DSH 全量可见）；
    仅 2026-07-28 客户端显式声明 used 时才裁剪（见 test_mcp_tools_pruned_by_declared_use）。
    tools/call 始终不拦截任何工具（裁剪只影响发现，不影响调用）。"""
    proc, q = mcp_proc["proc"], mcp_proc["q"]

    init = _rpc(proc, q, {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                          "params": {"protocolVersion": "2025-03-26",
                                     "clientInfo": {"name": "codex", "version": "1.0"}}})
    assert init["result"]["serverInfo"]["name"] == "agent-mcp"

    tools = _rpc(proc, q, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    names = [t["name"] for t in tools["result"]["tools"]]
    assert len(names) == 16
    for expect in MCP_TOOL_NAMES + ["orchestrate_task", "policy_list",
                                    "policy_add", "policy_state"]:
        assert expect in names


@pytest.mark.integration
def test_mcp_tools_pruned_by_declared_use(mcp_proc):
    """2026-07-28 无状态客户端显式声明 tools.used 时按声明裁剪（通用四件常驻）。"""
    proc, q = mcp_proc["proc"], mcp_proc["q"]

    tools = _rpc(proc, q, {"jsonrpc": "2.0", "id": 2, "method": "tools/list",
                           "params": {"_meta": {
                               "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                               "io.modelcontextprotocol/clientCapabilities": {"extensions": {
                                   "io.modelcontextprotocol/tools": {
                                       "used": ["send_message", "steer_agent"]}}}}}})
    names = [t["name"] for t in tools["result"]["tools"]]
    assert set(names) == {"spawn_agent", "wait_agent", "interrupt_agent",
                          "estimate_complexity", "send_message", "steer_agent"}


# ---- 性能：常驻内存 ----

@pytest.mark.integration
def test_daemon_resident_memory_below_100mb(daemon):
    """验收口径：daemon 常驻 <100MB（实测值打印供验收文档记录）。"""
    import psutil
    rss_mb = psutil.Process(daemon["pid"]).memory_info().rss / 1024 / 1024
    print(f"\ndaemon RSS: {rss_mb:.1f} MB")
    assert rss_mb < 100
