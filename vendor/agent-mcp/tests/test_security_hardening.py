"""A6 安全收紧测试：读端点鉴权、token 注入收敛、mailbox 身份校验、
verify_command 去 shell 化。

威胁模型（个人版范围）：本机回环上的任意进程此前可免鉴权读取全部 agent
数据流，甚至从 GET / 的 HTML 里提取明文 token 获得完整控制面；verify_command
以 shell=True 执行 LLM 可控字符串。本文件锁定这些面已关闭。

实现说明：不建真实 socket（测试安全约束禁止动态网络目标），改用探针方式——
object.__new__ 构造 Handler 实例、注入 path/headers 与内存 wfile，直接调用
真实的 do_GET/_send_index 鉴权与路由逻辑；HTTP 传输层由既有手工验收覆盖。
"""
import io
import json
from pathlib import Path

import pytest

from agent_mcp.daemon_http import DaemonHTTPServer, EventBroadcaster, Handler
from agent_mcp.daemon_main import Dispatcher, _run_verify
from agent_mcp.db import DB

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TOKEN = "sec-token-123"


class NoopWorker:
    def __call__(self, target_cli, **kwargs):
        return {"worker_pid": 0, "command_summary": "noop",
                "state_path": "", "out_path": "", "err_path": ""}


class _Headers:
    """最小 headers 桩：只暴露 Handler 用到的 .get。"""

    def __init__(self, mapping: dict[str, str] | None = None):
        self._m = mapping or {}

    def get(self, key, default=None):
        return self._m.get(key, default)


class _StubServer:
    """只承载 token/web_root/db/dispatcher/broadcaster 字段的服务器桩。"""

    def __init__(self, real_srv):
        self.token = real_srv.token
        self.web_root = real_srv.web_root
        self.db = real_srv.db
        self.dispatcher = real_srv.dispatcher
        self.broadcaster = real_srv.broadcaster


def make_probe(srv: DaemonHTTPServer, path: str,
               headers: dict[str, str] | None = None):
    """构造绕过 socket 初始化的 Handler 探针，捕获响应而不发网络包。"""
    probe = object.__new__(Handler)
    probe.server = _StubServer(srv)          # type: ignore[attr-defined]
    probe.path = path                        # type: ignore[attr-defined]
    probe.headers = _Headers(headers)        # type: ignore[attr-defined]
    probe.wfile = io.BytesIO()               # type: ignore[attr-defined]
    captured = {"error": None, "json": None, "sse": []}

    def fake_send_error(self, code, msg=None):
        captured["error"] = (code, msg)

    def fake_send_json(self, code, payload):
        captured["json"] = (code, payload)

    def fake_stream(self, message_mode=False):
        captured["sse"].append(message_mode)

    import types
    probe.send_error = types.MethodType(fake_send_error, probe)      # type: ignore
    probe._send_json = types.MethodType(fake_send_json, probe)       # type: ignore
    probe._stream_events = types.MethodType(fake_stream, probe)      # type: ignore
    return probe, captured


@pytest.fixture()
def sec_srv(tmp_path):
    db = DB(tmp_path / "s.sqlite3")
    disp = Dispatcher(db=db, broadcaster=EventBroadcaster(),
                      state_dir=tmp_path / "state", spawn_fn=NoopWorker())
    srv = DaemonHTTPServer(("127.0.0.1", 0), PROJECT_ROOT / "web",
                           token=TOKEN, db=db, dispatcher=disp,
                           broadcaster=disp.broadcaster)
    yield srv
    srv.server_close()


# ---- 令牌提取与校验 ----

def test_token_priority_header_over_query(sec_srv):
    probe, _ = make_probe(sec_srv, "/api/snapshot?token=query-token",
                          {"X-Auth-Token": TOKEN, "Host": "127.0.0.1"})
    assert probe._supplied_token() == TOKEN
    assert probe._has_valid_token() is True

    probe2, _ = make_probe(sec_srv, f"/api/snapshot?token={TOKEN}",
                           {"Host": "127.0.0.1"})
    assert probe2._supplied_token() == TOKEN
    assert probe2._has_valid_token() is True


def test_snapshot_requires_token(sec_srv):
    # 无令牌 → 401
    probe, cap = make_probe(sec_srv, "/api/snapshot", {"Host": "127.0.0.1"})
    probe.do_GET()
    assert cap["error"] is not None and cap["error"][0] == 401
    # header 令牌 → 放行到快照
    probe2, cap2 = make_probe(sec_srv, "/api/snapshot",
                              {"X-Auth-Token": TOKEN, "Host": "127.0.0.1"})
    probe2.do_GET()
    assert cap2["error"] is None and cap2["json"] is not None
    # query 令牌（SSE/EventSource 通道）→ 放行
    probe3, cap3 = make_probe(sec_srv, f"/api/snapshot?token={TOKEN}",
                              {"Host": "127.0.0.1"})
    probe3.do_GET()
    assert cap3["error"] is None
    # 错误令牌 → 401
    probe4, cap4 = make_probe(sec_srv, "/api/snapshot?token=wrong",
                              {"Host": "127.0.0.1"})
    probe4.do_GET()
    assert cap4["error"] is not None and cap4["error"][0] == 401


@pytest.mark.parametrize("path", ["/events", "/api/events"])
def test_sse_streams_require_token(sec_srv, path):
    probe, cap = make_probe(sec_srv, path, {"Host": "127.0.0.1"})
    probe.do_GET()
    assert cap["error"] is not None and cap["error"][0] == 401
    assert cap["sse"] == []

    probe2, cap2 = make_probe(sec_srv, f"{path}?token={TOKEN}",
                              {"Host": "127.0.0.1"})
    probe2.do_GET()
    assert cap2["error"] is None
    assert cap2["sse"] == [path == "/api/events"]  # message 通道标志


def test_index_stops_leaking_token_to_unauthenticated_requests(sec_srv):
    """修复核心：此前任意本机进程 GET / 即可从 HTML 提取明文 token。"""
    probe, cap = make_probe(sec_srv, "/", {"Host": "127.0.0.1"})

    sent_headers: list[tuple[str, str]] = []

    def fake_send_response(self, code):
        sent_headers.append(("status", str(code)))

    def fake_send_header(self, k, v):
        sent_headers.append((k, v))

    def fake_end(self):
        pass

    import types
    probe.send_response = types.MethodType(fake_send_response, probe)   # type: ignore
    probe.send_header = types.MethodType(fake_send_header, probe)       # type: ignore
    probe.end_headers = types.MethodType(fake_end, probe)               # type: ignore

    probe.do_GET()
    html = probe.wfile.getvalue().decode("utf-8", "replace")
    assert TOKEN not in html
    assert "window.__amToken=null" in html

    # 携带有效令牌的请求仍能拿到注入（授权后的页面会话）
    probe2, _ = make_probe(sec_srv, f"/?token={TOKEN}", {"Host": "127.0.0.1"})
    probe2.send_response = types.MethodType(fake_send_response, probe2)  # type: ignore
    probe2.send_header = types.MethodType(fake_send_header, probe2)      # type: ignore
    probe2.end_headers = types.MethodType(fake_end, probe2)              # type: ignore
    probe2.do_GET()
    html2 = probe2.wfile.getvalue().decode("utf-8", "replace")
    assert f"window.__amToken={json.dumps(TOKEN)}" in html2


# ---- mailbox 身份校验 ----

def test_mailbox_rejects_forged_identity(tmp_path, sec_srv):
    disp = sec_srv.dispatcher
    with pytest.raises(ValueError, match="不存在"):
        disp.mailbox_send({"team": "t", "from_agent_id": 424242,
                           "message": "forged"})
    real_id = sec_srv.db.insert_agent(
        parent_id=None, session_id="sess-real", task_name="t", cli="claude")
    with pytest.raises(ValueError, match="does not belong to session"):
        disp.consensus_vote({"team": "t", "action": "vote",
                             "from_agent_id": real_id,
                             "session_id": "sess-other", "vote": True})
    # 合法身份：同会话成员可投票
    out = disp.consensus_vote({"team": "t", "action": "vote",
                               "from_agent_id": real_id,
                               "session_id": "sess-real", "vote": True})
    assert out["status"] == "voted"
    del tmp_path


# ---- verify_command 收敛 ----

def test_verify_no_longer_interprets_shell_metacharacters(tmp_path):
    marker = tmp_path / "pwned.txt"
    ok, output = _run_verify(f"echo pwned > {marker}", cwd=str(tmp_path))
    # shell=False：重定向符被当作普通参数传给 echo，不会创建文件
    assert not marker.exists()
    assert "pwned" in output  # 参数被原样 echo 出来


def test_verify_rejects_unparseable_and_empty(tmp_path):
    ok, out = _run_verify('"unclosed quote', cwd=str(tmp_path))
    assert not ok and "cannot safely parse" in out
    ok, out = _run_verify("   ", cwd=str(tmp_path))
    assert not ok and "empty" in out


def test_verify_allowlist_prefix_enforced(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_MCP_VERIFY_ALLOW_PREFIXES", "pytest,/usr/bin/python3")
    ok, out = _run_verify("rm -rf ./x", cwd=str(tmp_path))
    assert not ok and "allowlist" in out
    ok, out = _run_verify("pytest -q", cwd=str(tmp_path))
    # pytest 不在环境里也没关系：已通过白名单进入执行阶段（报的是执行错误而非拒绝）
    assert "allowlist" not in out
