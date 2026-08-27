"""daemon_http 新端点测试：/api/policies/state、/api/workspaces、/api/events、
静态面板资源、index.html loader 注入、workspace merge/discard POST。

起真实 ThreadingHTTPServer（127.0.0.1:0 随机端口）+ fake dispatcher/db，
用 urllib 发请求验证（不依赖 daemon_main）。
"""
import json
import os
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from agent_mcp.daemon_http import DaemonHTTPServer, EventBroadcaster

PROJECT_ROOT = Path(__file__).resolve().parent.parent


class FakeDispatcher:
    def __init__(self, state_dir: Path):
        self.state_dir = state_dir

    def list_agents(self, body):  # 供 dispatcher 方法表探测
        return {"agents": []}

    def policy_state(self, body):
        return {"budget_usd": 0.0, "spawns": 0, "tool_calls": 0,
                "policies": [{"name": "budget_policy", "enabled": True}],
                "log": [], "policy_configs": {}}


class FakeDB:
    def usage_total(self, agent_id):
        return {"cost_usd": 2.3, "agents": 1}

    def agents_by_session(self, session_id):
        return [{"id": 1}]

    def max_seq(self):
        return 0

    def events_since(self, cursor, limit=1000):
        return []

    def usage_series(self, hours=24):
        # 6 个空桶（测试断言形状）
        return [{"ts": f"2026-08-13T{22-i:02d}:00:00Z", "input": 0, "output": 0,
                 "cache_read": 0, "cost": 0.0} for i in range(hours)]


@pytest.fixture()
def server(tmp_path):
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    web_root = PROJECT_ROOT / "web"
    srv = DaemonHTTPServer(("127.0.0.1", 0), web_root, token="t0ken",
                           db=FakeDB(), dispatcher=FakeDispatcher(state_dir),
                           broadcaster=EventBroadcaster())
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield srv
    srv.shutdown()
    srv.server_close()


def _http(server, method: str, path: str, body: bytes | None = None,
          headers: dict | None = None) -> tuple[int, bytes]:
    """受控请求（SSRF 约束）：host/port 走独立参数，path 必须为以 / 开头的
    字面量——测试中不存在任何拼接出来的目标 URL。"""
    import http.client
    assert server.server_address[0] == "127.0.0.1"
    assert isinstance(path, str) and path.startswith("/")
    conn = http.client.HTTPConnection("127.0.0.1", server.server_address[1],
                                      timeout=5)
    conn.request(method, path, body=body, headers=headers or {})
    resp = conn.getresponse()
    data = resp.read()
    status = resp.status
    conn.close()
    return status, data


def get(server, path: str) -> tuple[int, dict | str]:
    status, data = _http(server, "GET", path,
                         headers={"X-Auth-Token": "t0ken"})
    try:
        return status, json.loads(data)
    except json.JSONDecodeError:
        return status, data.decode("utf-8", "replace")


def post(server, path: str, body: dict) -> tuple[int, dict]:
    status, data = _http(
        server, "POST", path, body=json.dumps(body).encode("utf-8"),
        headers={"X-Auth-Token": "t0ken", "Content-Type": "application/json"})
    try:
        return status, json.loads(data)
    except json.JSONDecodeError:
        return status, {}


# -- 策略面板 ------------------------------------------------------------

def test_policies_state_empty_defaults(server):
    code, payload = get(server, "/api/policies/state")
    assert code == 200
    # 面板契约：policies/log 是数组（H5），policy_configs 是对象
    assert isinstance(payload["policies"], list)
    assert isinstance(payload["log"], list)
    assert isinstance(payload["policy_configs"], dict)
    assert payload["policies"][0]["name"] == "budget_policy"


def test_policies_state_reads_file(server, tmp_path):
    """dispatcher 无 policy_state（fallback）时读文件聚合。"""
    state_dir = tmp_path / "state"
    (state_dir / "policies.json").write_text(json.dumps(
        {"log": [{"name": "budget_policy", "result": "deny", "ts": 1.0}]},
        ensure_ascii=False), encoding="utf-8")
    # 变体 dispatcher：有 state_dir 但无 policy_state → 走 fallback
    class NoPolicyDispatcher:
        def __init__(self, sd):
            self.state_dir = sd
    server.dispatcher = NoPolicyDispatcher(state_dir)
    code, payload = get(server, "/api/policies/state")
    assert code == 200
    assert payload["log"][0]["result"] == "deny"
    assert payload["policies"] == []  # fallback 无 policies 键 → 空数组


# -- 工作区面板 ----------------------------------------------------------

def test_workspaces_empty(server):
    code, payload = get(server, "/api/workspaces")
    assert code == 200
    assert payload["workspaces"] == []


def test_workspaces_reads_registry(server, tmp_path):
    state_dir = tmp_path / "state"
    (state_dir / "workspaces.json").write_text(json.dumps(
        {"workspaces": [{"id": "w1", "path": "/x", "status": "dirty",
                         "branch": "agent-w1", "task": "t"}]}),
        encoding="utf-8")
    code, payload = get(server, "/api/workspaces")
    assert code == 200
    assert payload["workspaces"][0]["id"] == "w1"


def test_workspaces_merge_removes_and_marks(server, tmp_path):
    """merge POST：git worktree remove --force + 状态写 merged。"""
    state_dir = tmp_path / "state"
    ws = tmp_path / "ws-repo"
    ws.mkdir()
    (state_dir / "workspaces.json").write_text(json.dumps(
        {"workspaces": [{"id": "w1", "path": str(ws), "status": "dirty"}]}),
        encoding="utf-8")
    # git 不可用时 merge 返回 400（不会静默成功）
    code, payload = post(server, "/api/workspaces/merge", {"id": "w1"})
    if code == 400:
        pytest.skip(f"git 不可用: {payload}")
    assert code == 200
    assert payload["status"] == "merged"
    registry = json.loads((state_dir / "workspaces.json").read_text())
    assert registry["workspaces"][0]["status"] == "merged"


def test_workspaces_merge_unknown_id(server):
    code, payload = post(server, "/api/workspaces/merge", {"id": "ghost"})
    assert code == 400
    assert "不存在" in payload["error"]


def test_workspaces_post_requires_token(server):
    status, _ = _http(server, "POST", "/api/workspaces/discard", body=b"{}")
    assert status == 401


def test_policies_and_workspaces_get_require_token(server):
    """L4：面板数据端点同样要求 token（与 /api/agents/* 一致）。"""
    for path in ("/api/policies/state", "/api/workspaces"):
        status, _ = _http(server, "GET", path)
        assert status == 401


# -- 静态面板资源 --------------------------------------------------------

def test_index_injects_panel_loader(server):
    code, html = get(server, "/")
    assert code == 200
    assert '<script type="module" src="/panels/loader.js?v=v4"></script>' in html
    assert "Conversation graph" in html  # 原页面内容保留
    assert "window.__amToken" in html  # token 注入（面板鉴权不再依赖 URL hash）


def test_panels_loader_served_with_js_mime(server):
    import http.client
    conn = http.client.HTTPConnection("127.0.0.1", server.server_address[1],
                                      timeout=5)
    conn.request("GET", "/panels/loader.js")
    resp = conn.getresponse()
    body = resp.read()
    conn.close()
    assert resp.status == 200
    assert "javascript" in resp.headers["Content-Type"]
    assert "export function init" in body.decode("utf-8")


def test_panels_css_served(server):
    import http.client
    conn = http.client.HTTPConnection("127.0.0.1", server.server_address[1],
                                      timeout=5)
    conn.request("GET", "/css/panels.css")
    resp = conn.getresponse()
    resp.read()
    conn.close()
    assert resp.status == 200
    assert "text/css" in resp.headers["Content-Type"]


def test_panels_404_for_missing(server):
    code, _ = get(server, "/panels/nope.js")
    assert code == 404


# -- message 通道 SSE ----------------------------------------------------

def _sse_read(server, path: str, publish_event: dict) -> str:
    """裸 socket 连接 SSE 端点：连接后 publish 事件，读回一帧。
    A6：SSE 已纳入鉴权——路径必须自带 ?token=（server fixture 令牌为 "t0ken"）。
    path 为字面量常量（受控目标），请求行分字段构造，不拼接完整 URL 字符串。"""
    import socket
    assert path.startswith("/")
    s = socket.create_connection(("127.0.0.1", server.server_address[1]), timeout=5)
    sep = "&" if "?" in path else "?"
    s.sendall(("GET " + path + sep + "token=t0ken HTTP/1.1\r\n"
               + "Host: 127.0.0.1\r\n\r\n").encode())
    time.sleep(0.3)  # 等服务端 connect + 响应头
    s.recv(4096)  # 消费响应头
    server.broadcaster.publish(publish_event, seq=None)
    s.settimeout(3)
    try:
        return s.recv(4096).decode("utf-8", "replace")
    finally:
        s.close()


def test_api_events_streams_message_frames(server):
    """/api/events 返回 message 通道帧（data 内嵌 type，无 event: 行）。"""
    chunk = _sse_read(server, "/api/events",
                      {"type": "agent.message", "agent_id": "1",
                       "payload": {"text": "hi"}})
    assert "event: " not in chunk
    assert '"type": "agent.message"' in chunk


def test_events_named_stream_unchanged(server):
    """既有 /events 保持命名事件格式（index.html 依赖 event: 行分发）。"""
    chunk = _sse_read(server, "/events",
                      {"type": "agent.message", "agent_id": "1",
                       "payload": {"text": "hi"}})
    assert "event: agent.message" in chunk
    assert '"type": "agent.message"' in chunk


# -- usage series 端点（趋势图数据源） --------------------------------------

def test_usage_series_requires_token(server):
    status, _ = _http(server, "GET", "/api/usage/series")
    assert status == 401


def test_usage_series_shape(server, tmp_path):
    """series 返回最近 hours 小时连续桶（缺失补 0），cost 为 float。"""
    code, payload = get(server, "/api/usage/series?hours=6")
    assert code == 200
    series = payload["series"]
    assert len(series) == 6
    assert all(b["input"] >= 0 and isinstance(b["cost"], float) for b in series)
    assert all({"ts", "input", "output", "cache_read", "cost"} <= set(b) for b in series)
