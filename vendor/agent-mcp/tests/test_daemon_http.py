import json
import threading
import time
import urllib.error
import urllib.request

import pytest

from agent_mcp.daemon_http import DaemonHTTPServer, EventBroadcaster


def test_broadcaster_connect_limit_and_close():
    b = EventBroadcaster(max_clients=2)
    c1 = b.connect()
    c2 = b.connect()
    assert c1 is not None and c2 is not None
    assert b.connect() is None  # 超限
    b.close(c1)
    assert b.connect() is not None


def test_broadcaster_publish_and_heartbeat():
    b = EventBroadcaster(max_clients=2)
    c = b.connect()
    b.publish({"type": "agent.message", "agent_id": 1}, seq=1)
    b.heartbeat_all()
    joined = "".join(c["buffer"])
    assert "id: 1" in joined and "agent.message" in joined and ": ping" in joined


def _make_server(tmp_path):
    from agent_mcp.db import DB
    srv = DaemonHTTPServer(("127.0.0.1", 0), tmp_path, token="t",
                           db=DB(tmp_path / "test.db"), dispatcher=None)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    return srv


def _request_json(srv, path: str):
    """受控 GET（http.client + 纯字面量路径）：返回 (status, bytes)。"""
    import http.client
    conn = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=5)
    conn.request("GET", path)
    resp = conn.getresponse()
    body = resp.read()
    status = resp.status
    conn.close()
    return status, body


def _http(srv, method: str, path: str, body: bytes | None = None,
          headers: dict | None = None):
    """受控请求（SSRF 约束）：host/port 走独立参数，path 必须为以 / 开头的
    字面量；返回 (status, headers, bytes)，不抛 HTTP 错误。"""
    import http.client
    assert srv.server_address[0] == "127.0.0.1"
    assert isinstance(path, str) and path.startswith("/")
    conn = http.client.HTTPConnection("127.0.0.1", srv.server_address[1],
                                      timeout=5)
    conn.request(method, path, body=body, headers=headers or {})
    resp = conn.getresponse()
    data = resp.read()
    status = resp.status
    conn.close()
    return status, resp.headers, data


def test_health_endpoint(tmp_path):
    srv = _make_server(tmp_path)
    try:
        status, _, body = _http(srv, "GET", "/health")
        assert status == 200
        assert json.loads(body)["ok"] is True
    finally:
        srv.shutdown()

def test_health_identifies_daemon_without_exposing_token(tmp_path):
    import hashlib
    srv = _make_server(tmp_path)
    try:
        _, _, body = _http(srv, "GET", "/health")
        body = json.loads(body)
        assert body["service"] == "agent-mcp-daemon"
        assert body["token_sha256"] == hashlib.sha256(b"t").hexdigest()
        assert "token" not in body
    finally:
        srv.shutdown()


def test_config_endpoint_never_exposes_write_token(tmp_path):
    srv = _make_server(tmp_path)
    try:
        _, _, body = _http(srv, "GET", "/api/config")
        assert json.loads(body) == {"max_message_chars": 20_000,
                                    "write_auth": "url-fragment"}
    finally:
        srv.shutdown()


def test_html_and_json_responses_send_security_headers(tmp_path):
    (tmp_path / "index.html").write_text("<html></html>", encoding="utf-8")
    srv = _make_server(tmp_path)
    try:
        for path in ("/", "/health"):
            _, headers, _ = _http(srv, "GET", path)
            assert headers["X-Frame-Options"] == "DENY"
            assert "frame-ancestors 'none'" in headers["Content-Security-Policy"]
            assert headers["X-Content-Type-Options"] == "nosniff"
    finally:
        srv.shutdown()



def test_bad_host_rejected(tmp_path):
    """Host 头白名单：evil Host → 400（http.client 直连，不经系统代理）。"""
    srv = _make_server(tmp_path)
    try:
        status, _, _ = _http(srv, "GET", "/health",
                             headers={"Host": "evil.example.com"})
        assert status == 400
    finally:
        srv.shutdown()


def test_post_without_token_unauthorized(tmp_path):
    srv = _make_server(tmp_path)
    try:
        status, _, _ = _http(srv, "POST", "/api/agents/spawn", body=b"{}")
        assert status == 401
    finally:
        srv.shutdown()


def test_post_with_token_dispatcher_not_ready(tmp_path):
    srv = _make_server(tmp_path)
    try:
        status, _, body = _http(srv, "POST", "/api/agents/spawn", body=b"{}",
                                headers={"X-Auth-Token": "t"})
        assert status == 503
        assert json.loads(body)["error"] == "dispatcher not ready"
    finally:
        srv.shutdown()


def _request_json(srv, path: str):
    """受控 GET（http.client + 纯字面量路径）：返回 (status, bytes)。"""
    import http.client
    conn = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=5)
    conn.request("GET", path)
    resp = conn.getresponse()
    body = resp.read()
    status = resp.status
    conn.close()
    return status, body


def test_snapshot_returns_agents_events_usage(tmp_path):
    srv = _make_server(tmp_path)
    try:
        aid = srv.db.insert_agent(parent_id=None, session_id="snap1", task_name="t",
                                  cli="claude", model="m", cwd=str(tmp_path))
        srv.db.set_status(aid, "terminated", stop_reason="end_turn", pid=1)
        srv.db.insert_event(agent_id=aid, type="agent.message",
                            payload={"text": "hi"}, session_id="snap1")
        srv.db.upsert_usage(agent_id=aid, model="aggregate", input_tokens=10,
                            output_tokens=5, cache_creation=0, cache_read=2,
                            cost_usd=0.1)
        status, body = _request_json(srv, "/api/snapshot?session_id=snap1&token=t")
        assert status == 200
        body = json.loads(body)
        assert [a["id"] for a in body["agents"]] == [aid]
        assert body["agents"][0]["status"] == "terminated"
        assert body["agents"][0]["stop_reason"] == "end_turn"
        assert body["events"][-1]["type"] == "agent.message"
        assert body["events"][-1]["payload"]["text"] == "hi"
        assert body["usage"]["totals"]["input_tokens"] == 10
        assert body["usage"]["per_agent"][0]["output_tokens"] == 5
        assert body["last_seq"] == body["events"][-1]["seq"]
    finally:
        srv.shutdown()


def test_snapshot_auth_and_session_filter(tmp_path):
    """A6 收紧后语义：无令牌 401；?token= 放行；session 过滤照旧。"""
    srv = _make_server(tmp_path)
    try:
        srv.db.insert_agent(parent_id=None, session_id="only", task_name="a",
                            cli="claude", model=None, cwd=str(tmp_path))
        status, _ = _request_json(srv, "/api/snapshot")
        assert status == 401
        status, body = _request_json(srv, "/api/snapshot?token=t")
        assert status == 200
        body = json.loads(body)
        assert [a["task_name"] for a in body["agents"]] == ["a"]
        status, _ = _request_json(srv, "/api/snapshot?token=t&session_id=nope")
        assert status == 400
    finally:
        srv.shutdown()


def test_events_last_seq_replays_persisted_events_then_live(tmp_path):
    """/events?last_seq=N：先回放 SQLite 中 seq>N 的事件，随后进入 live；不重复。"""
    import http.client
    srv = _make_server(tmp_path)
    try:
        aid = srv.db.insert_agent(parent_id=None, session_id="s", task_name="t",
                                  cli="claude", cwd=str(tmp_path))
        for i in range(3):
            srv.db.insert_event(agent_id=aid, type="agent.message",
                                payload={"i": i}, session_id="s")
        got = []

        def read():
            conn = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=5)
            conn.request("GET", "/events?last_seq=1&token=t")
            resp = conn.getresponse()
            got.append(resp.read1(65536))  # 回放段即时写出
            time.sleep(0.6)
            got.append(resp.read1(65536))  # live 段
            conn.close()

        t = threading.Thread(target=read)
        t.start()
        time.sleep(0.4)
        srv.broadcaster.publish({"type": "agent.running", "agent_id": aid,
                                 "payload": {}, "seq": 4}, seq=4)
        t.join(timeout=5)
        assert not t.is_alive()
        data = (got[0] or b"").decode("utf-8", "replace") + \
               (got[1] or b"").decode("utf-8", "replace")
        assert "id: 2\n" in data and "id: 3\n" in data
        assert "id: 1\n" not in data          # last_seq=1 之前的 seq1 不回放
        assert data.count("event: agent.message") == 2  # seq2/seq3 各一次，不重复
        assert "id: 4\n" in data and "event: agent.running" in data  # 进入 live
    finally:
        srv.shutdown()


def test_events_replays_over_1000_persisted_events_tail_delivered(tmp_path):
    """>1000 条持久化事件断线回放：分页补齐 (last_seq, boundary]，
    尾部 seq 必须交付，不丢不重、严格递增。"""
    import http.client
    import re
    import socket
    srv = _make_server(tmp_path)
    try:
        aid = srv.db.insert_agent(parent_id=None, session_id="big", task_name="t",
                                  cli="claude", cwd=str(tmp_path))
        total = 1005  # 回放范围 (3, 1005] 共 1002 条 > 1000 单页上限
        for i in range(total):
            srv.db.insert_event(agent_id=aid, type="agent.message",
                                payload={"i": i}, session_id="big")
        data = bytearray()

        def read():
            conn = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=10)
            conn.request("GET", "/events?last_seq=3&token=t")
            resp = conn.getresponse()
            deadline = time.time() + 25
            while time.time() < deadline:
                try:
                    chunk = resp.read1(65536)
                except (socket.timeout, TimeoutError):
                    break
                if not chunk:
                    break
                data.extend(chunk)
                if b"id: 1005\n" in data:
                    break
            conn.close()

        t = threading.Thread(target=read)
        t.start()
        t.join(timeout=30)
        assert not t.is_alive(), "SSE 读取线程未在期限内结束"
        text = bytes(data).decode("utf-8", "replace")
        ids = [int(m) for m in re.findall(r"id: (\d+)\n", text)]
        assert ids == list(range(4, total + 1)), \
            f"seq 缺漏/重复/乱序: 共{len(ids)}条, 头{ids[:3]} 尾{ids[-3:]}"
        assert text.count("event: agent.message") == total - 3
    finally:
        srv.shutdown()


def test_events_replay_over_1000_with_live_publish_race_no_dup(tmp_path):
    """>1000 回放期间 live publish 与回放范围重叠：重叠 seq 恰好交付一次，
    回放范围内外事件顺序严格、无重复。"""
    import http.client
    import re
    import socket
    srv = _make_server(tmp_path)
    try:
        aid = srv.db.insert_agent(parent_id=None, session_id="race", task_name="t",
                                  cli="claude", cwd=str(tmp_path))
        total = 1005
        for i in range(total):
            srv.db.insert_event(agent_id=aid, type="agent.message",
                                payload={"i": i}, session_id="race")
        data = bytearray()

        def read():
            conn = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=10)
            conn.request("GET", "/events?last_seq=3&token=t")
            resp = conn.getresponse()
            deadline = time.time() + 25
            while time.time() < deadline:
                try:
                    chunk = resp.read1(65536)
                except (socket.timeout, TimeoutError):
                    break
                if not chunk:
                    break
                data.extend(chunk)
                if b"id: 1010\n" in data:
                    break
            conn.close()

        t = threading.Thread(target=read)
        t.start()
        time.sleep(0.05)  # 回放进行中，模拟断线补发与 live 的竞态窗口
        # 回放范围内 (1004/1005) 与范围外 (1006..1010) 的 live 事件并发发布
        for seq in (1004, 1005):
            srv.broadcaster.publish({"type": "agent.message", "agent_id": aid,
                                     "payload": {"i": seq - 1}, "seq": seq}, seq=seq)
        for seq in range(1006, 1011):
            srv.broadcaster.publish({"type": "agent.running", "agent_id": aid,
                                     "payload": {}, "seq": seq}, seq=seq)
        t.join(timeout=30)
        assert not t.is_alive(), "SSE 读取线程未在期限内结束"
        text = bytes(data).decode("utf-8", "replace")
        ids = [int(m) for m in re.findall(r"id: (\d+)\n", text)]
        assert ids == list(range(4, 1011)), \
            f"seq 缺漏/重复/乱序: 共{len(ids)}条, 头{ids[:3]} 尾{ids[-3:]}"
        assert text.count("event: agent.message") == total - 3  # 1004/1005 live 副本不重复
        assert text.count("event: agent.running") == 5
    finally:
        srv.shutdown()


def test_oversized_json_body_rejected(tmp_path):
    import http.client
    srv = _make_server(tmp_path)
    try:
        big = json.dumps({"prompt": "x" * 1_100_000})
        conn = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=5)
        conn.request("POST", "/api/agents/spawn", body=big.encode(),
                     headers={"X-Auth-Token": "t", "Content-Type": "application/json"})
        resp = conn.getresponse()
        resp.read()
        assert resp.status == 413
        conn.close()
    finally:
        srv.shutdown()
