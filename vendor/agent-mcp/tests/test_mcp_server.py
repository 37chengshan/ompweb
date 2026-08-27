"""T10 MCP 薄层测试：JSON-RPC 协议层 + host 识别 + 原子拉起 + 工具面映射。

不依赖真实 daemon 进程：ensure_daemon/_daemon_post/_post_once 全部 monkeypatch。
"""
import json
import threading
from pathlib import Path

import pytest

import mcp_server


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch, tmp_path):
    """重置模块级会话变量，避免测试间串扰；session 持久化文件隔离到临时目录。"""
    monkeypatch.setattr(mcp_server, "_SESSION_ID", None)
    monkeypatch.setattr(mcp_server, "_HOST", "unknown")
    monkeypatch.setattr(mcp_server, "_NEGOTIATED_PROTOCOL_VERSION", None)
    monkeypatch.setattr(mcp_server, "_CLIENT_TASKS_CAPABLE", False)
    monkeypatch.setattr(mcp_server, "_DAEMON", None)
    monkeypatch.setattr(mcp_server, "SESSION_ID_PREFIX", tmp_path / "session-id")
    for var in mcp_server._HOST_SESSION_ENV_VARS:
        monkeypatch.delenv(var, raising=False)


# ---- initialize / tools/list / host ----

def test_initialize_returns_server_info():
    out = []
    mcp_server.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                       "params": {"clientInfo": {"name": "codex"}}}, emit=out.append)
    msg = out[0]
    assert msg["id"] == 1
    assert msg["result"]["serverInfo"] == {"name": "agent-mcp",
                                           "version": mcp_server.SERVER_VERSION}
    assert msg["result"]["protocolVersion"] == "2025-03-26"
    assert mcp_server._HOST == "codex"


def test_initialize_top_level_version_negotiation():
    """2025-11-25 客户端（DSH SDK 1.29.0）：顶层 protocolVersion 回显，会话生效。"""
    out = []
    mcp_server.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                       "params": {"protocolVersion": "2025-11-25",
                                  "clientInfo": {"name": "dsh-mcp-client", "version": "0.0.1"},
                                  "capabilities": {}}}, emit=out.append)
    assert out[0]["result"]["protocolVersion"] == "2025-11-25"
    assert mcp_server._NEGOTIATED_PROTOCOL_VERSION == "2025-11-25"
    # 后续请求复用会话版本：tools/list 带 modern 字段
    out.clear()
    mcp_server.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, emit=out.append)
    listed = out[0]["result"]
    assert listed["resultType"] == "complete"
    assert listed["ttlMs"] > 0 and listed["cacheScope"] == "public"


def test_initialize_unsupported_top_level_version_falls_back_to_legacy():
    """顶层版本不在支持集 → 回 legacy 兜底（SDK 客户端可接受），不报错。"""
    out = []
    mcp_server.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                       "params": {"protocolVersion": "2024-11-05",
                                  "clientInfo": {"name": "codex"}}}, emit=out.append)
    assert out[0]["result"]["protocolVersion"] == "2025-03-26"
    assert mcp_server._NEGOTIATED_PROTOCOL_VERSION == "2025-03-26"


def test_tools_list_returns_full_set_without_declared_use():
    """默认全量 19 工具（v0 mailbox/consensus 三工具并入）：legacy 客户端与
    未声明 used 的客户端均完整可见。"""
    out = []
    mcp_server.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                       "params": {"protocolVersion": "2025-11-25"}}, emit=out.append)
    out.clear()
    mcp_server.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, emit=out.append)
    names = [t["name"] for t in out[0]["result"]["tools"]]
    assert len(names) == 19
    for expect in ("spawn_agent", "wait_agent", "estimate_complexity", "send_message",
                   "steer_agent", "followup_task", "interrupt_agent", "list_agents",
                   "get_agent_activity", "get_token_usage", "memory_store", "memory_recall",
                   "orchestrate_task", "policy_list", "policy_add", "policy_state",
                   "mailbox_send", "mailbox_fetch", "consensus_vote"):
        assert expect in names


def test_tools_list_2026_stateless_declared_use_prunes():
    """2026-07-28 无状态客户端显式声明 used 时才裁剪，通用四件常驻。"""
    out = []
    mcp_server.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/list",
                       "params": {"_meta": {
                           "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                           "io.modelcontextprotocol/clientCapabilities": {"extensions": {
                               "io.modelcontextprotocol/tools": {"used": ["send_message"]}}}}}},
                      emit=out.append)
    names = [t["name"] for t in out[0]["result"]["tools"]]
    assert set(names) == {"spawn_agent", "wait_agent", "interrupt_agent",
                          "estimate_complexity", "send_message"}


def test_tools_list_has_nineteen_tools_in_order():
    names = [t["name"] for t in mcp_server.TOOLS]
    assert names == ["spawn_agent", "orchestrate_task", "policy_list", "policy_add",
                     "policy_state", "send_message", "steer_agent",
                     "followup_task", "wait_agent", "interrupt_agent", "list_agents",
                     "get_agent_activity", "get_token_usage", "estimate_complexity",
                     "memory_store", "memory_recall",
                     "mailbox_send", "mailbox_fetch", "consensus_vote"]


def test_spawn_schema_requires_cwd():
    """与 daemon Dispatcher 对齐：cwd 必填（缺失时 daemon 返回 400）。"""
    schema = next(t for t in mcp_server.TOOLS if t["name"] == "spawn_agent")["inputSchema"]
    assert "cwd" in schema["required"]
    assert set(schema["required"]) == {"target_cli", "prompt", "cwd"}

def test_spawn_schema_lists_atomcode_task_cli():
    schema = next(tool for tool in mcp_server.TOOLS if tool["name"] == "spawn_agent")["inputSchema"]
    enum = schema["properties"]["target_cli"]["enum"]
    for expect in ("claude", "grok", "opencode", "omp", "atomcode",
                   "codex", "kimi", "copilot", "pi", "zcode", "cline"):
        assert expect in enum


def test_wait_agent_schema_timeout_custom_cap():
    """wait_agent 单次等待上限可自定义：schema maximum 跟随 MAX_WAIT_SECONDS（>30），默认短阻塞 25（≤客户端截断上限）。"""
    tool = next(t for t in mcp_server.TOOLS if t["name"] == "wait_agent")
    schema = tool["inputSchema"]
    prop = schema["properties"]["timeout"]
    assert prop["minimum"] == 1
    assert prop["default"] == 25  # 单次短阻塞：≤ MCP 客户端 ~30s 截断上限
    assert prop["maximum"] == int(mcp_server.MAX_WAIT_SECONDS)
    assert prop["maximum"] > 30  # 上限可放宽（长等待由多次循环调用覆盖）
    cap = f"{mcp_server.MAX_WAIT_SECONDS:.0f}"
    assert cap in tool["description"] or cap in prop["description"]


def test_server_discover_advertises_dual_era_and_task_extension():
    out = []
    mcp_server.handle({"jsonrpc": "2.0", "id": "d1", "method": "server/discover",
                       "params": {"_meta": {
                           "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                           "io.modelcontextprotocol/clientInfo": {"name": "codex", "version": "1"},
                           "io.modelcontextprotocol/clientCapabilities": {"extensions": {
                               "io.modelcontextprotocol/tasks": {}}}}}}, emit=out.append)
    result = out[0]["result"]
    assert result["resultType"] == "complete"
    assert result["supportedVersions"] == ["2026-07-28", "2025-11-25", "2025-03-26"]
    assert "io.modelcontextprotocol/tasks" in result["capabilities"]["extensions"]
    assert result["ttlMs"] > 0 and result["cacheScope"] == "public"


def test_modern_tools_list_has_cache_and_result_type():
    out = []
    mcp_server.handle({"jsonrpc": "2.0", "id": 9, "method": "tools/list",
                       "params": {"_meta": {
                           "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                           "io.modelcontextprotocol/clientCapabilities": {}}}}, emit=out.append)
    result = out[0]["result"]
    assert result["resultType"] == "complete"
    assert result["ttlMs"] > 0 and result["cacheScope"] == "public"


def test_modern_request_rejects_unsupported_protocol_version():
    out = []
    mcp_server.handle({"jsonrpc": "2.0", "id": 10, "method": "tools/list",
                       "params": {"_meta": {
                           "io.modelcontextprotocol/protocolVersion": "1900-01-01",
                           "io.modelcontextprotocol/clientCapabilities": {}}}}, emit=out.append)
    assert out[0]["error"]["code"] == -32022
    assert out[0]["error"]["data"]["supported"] == ["2026-07-28", "2025-11-25", "2025-03-26"]


def test_steer_agent_tool_maps_to_daemon():
    assert "steer_agent" in [tool["name"] for tool in mcp_server.TOOLS]
    assert mcp_server._DAEMON_PATHS["steer_agent"] == "/api/agents/steer"


def _modern_task_meta():
    return {"io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {"extensions": {
                "io.modelcontextprotocol/tasks": {}}}}


def test_modern_spawn_with_tasks_capability_returns_flat_durable_task(monkeypatch):
    monkeypatch.setattr(mcp_server, "call_tool", lambda name, args: {
        "agent_id": 7, "status": "running", "pid": 123,
        "created_at": "2026-08-04T10:00:00+00:00",
        "updated_at": "2026-08-04T10:00:01+00:00"})
    out = []
    mcp_server.handle({"jsonrpc": "2.0", "id": 11, "method": "tools/call",
                       "params": {"name": "spawn_agent", "arguments": {
                           "target_cli": "claude", "prompt": "x", "cwd": "/tmp"},
                           "_meta": _modern_task_meta()}}, emit=out.append)
    task = out[0]["result"]
    # 2026-07-28 resultType 枚举：complete/input_required（任务句柄用 complete，状态由 status 表达）
    assert task["resultType"] == "complete"
    assert "task" not in task
    assert task["taskId"] == "agent:7"
    assert task["status"] == "working"
    assert task["createdAt"] == "2026-08-04T10:00:00+00:00"
    assert task["lastUpdatedAt"] == "2026-08-04T10:00:01+00:00"
    # 字段名对齐官方 schema（2025-11-25 SDK：ttl / pollInterval）
    assert task["ttl"] == 604_800_000
    assert task["pollInterval"] == 1000


def test_2025_11_25_client_capabilities_tasks_enables_task_methods(monkeypatch):
    """2025-11-25 客户端在 initialize 的 capabilities.tasks 声明（experimental）→ tasks 方法可用。"""
    monkeypatch.setattr(mcp_server, "call_tool", lambda name, args: {
        "agent_id": 7, "status": "running",
        "created_at": "2026-08-04T10:00:00+00:00",
        "updated_at": "2026-08-04T10:00:01+00:00"})
    out = []
    mcp_server.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                       "params": {"protocolVersion": "2025-11-25",
                                  "capabilities": {"tasks": {"list": {}, "cancel": {}}}}},
                      emit=out.append)
    assert mcp_server._CLIENT_TASKS_CAPABLE is True
    out.clear()
    mcp_server.handle({"jsonrpc": "2.0", "id": 12, "method": "tasks/get",
                       "params": {"taskId": "agent:7"}}, emit=out.append)
    task = out[0]["result"]
    assert task["taskId"] == "agent:7"
    assert task["resultType"] == "complete"
    assert task["ttl"] == 604_800_000


def test_tasks_get_is_complete_flat_task(monkeypatch):
    monkeypatch.setattr(mcp_server, "call_tool", lambda name, args: {
        "agent_id": 7, "status": "running",
        "created_at": "2026-08-04T10:00:00+00:00",
        "updated_at": "2026-08-04T10:00:01+00:00"})
    out = []
    mcp_server.handle({"jsonrpc": "2.0", "id": 12, "method": "tasks/get",
                       "params": {"taskId": "agent:7", "_meta": _modern_task_meta()}},
                      emit=out.append)
    task = out[0]["result"]
    assert task["resultType"] == "complete"
    assert "task" not in task
    assert task["taskId"] == "agent:7"


def test_tasks_update_accepts_arbitrary_input_and_cancel_interrupts(monkeypatch):
    calls = []
    monkeypatch.setattr(mcp_server, "call_tool",
                        lambda name, args: calls.append((name, args)) or {"status": "running"})
    for method, params in [
        ("tasks/update", {"taskId": "agent:7", "inputResponses": {
            "steer": {"action": "accept", "content": {"input": "改做 B"}}},
            "_meta": _modern_task_meta()}),
        ("tasks/cancel", {"taskId": "agent:7", "_meta": _modern_task_meta()}),
    ]:
        out = []
        mcp_server.handle({"jsonrpc": "2.0", "id": method, "method": method,
                           "params": params}, emit=out.append)
        assert out[0]["result"]["resultType"] == "complete"
    assert calls == [("steer_agent", {"agent_id": 7, "message": "改做 B"}),
                     ("interrupt_agent", {"agent_id": 7})]


@pytest.mark.parametrize("method", ["tasks/get", "tasks/update", "tasks/cancel"])
def test_task_methods_require_negotiated_capability(method):
    out = []
    mcp_server.handle({"jsonrpc": "2.0", "id": method, "method": method,
                       "params": {"taskId": "agent:7"}}, emit=out.append)
    # 2026-07-28 错误码重编号：MissingRequiredClientCapability → -32021
    assert out[0]["error"]["code"] == -32021


@pytest.mark.parametrize("method", ["tasks/get", "tasks/update", "tasks/cancel"])
def test_task_methods_notification_silent(method):
    """JSON-RPC 通知（无 id）不应返回任何响应。"""
    out = []
    params = {"taskId": "agent:1", "_meta": _modern_task_meta()}
    if method == "tasks/update":
        params["inputResponses"] = {"x": {"action": "accept", "content": "msg"}}
    mcp_server.handle({"jsonrpc": "2.0", "method": method, "params": params},
                       emit=out.append)
    assert out == []  # 无 id 则不 emit


@pytest.mark.parametrize("method", ["tasks/get", "tasks/update", "tasks/cancel"])
def test_task_methods_propagate_daemon_errors(monkeypatch, method):
    monkeypatch.setattr(mcp_server, "call_tool", lambda name, args: {
        "status": "error", "http_status": 400, "summary": "agent 999 not found"})
    params = {"taskId": "agent:999", "_meta": _modern_task_meta()}
    if method == "tasks/update":
        params["inputResponses"] = {"x": {"action": "accept", "content": "retry"}}
    out = []
    mcp_server.handle({"jsonrpc": "2.0", "id": method, "method": method,
                       "params": params}, emit=out.append)
    assert out[0]["error"]["code"] == -32602
    assert "not found" in out[0]["error"]["message"]


def test_call_tool_wait_agent_overrides_http_timeout(monkeypatch):
    """wait_agent 按请求 timeout 叠加 HTTP 层超时（避免 daemon 等待时请求被掐断）。"""
    captured = {}

    def fake_post(path, payload, http_timeout=None):
        captured["path"] = path
        captured["payload"] = payload
        captured["http_timeout"] = http_timeout
        return {"status": "running"}

    monkeypatch.setattr(mcp_server, "_daemon_post", fake_post)
    mcp_server.call_tool("wait_agent", {"agent_id": 7, "timeout": 120})
    assert captured["path"] == "/api/agents/wait"
    assert captured["payload"]["timeout"] == 120
    assert captured["http_timeout"] == mcp_server._HTTP_TIMEOUT + 120
    # 超上限时钳制到 MAX_WAIT_SECONDS
    mcp_server.call_tool("wait_agent", {"agent_id": 8, "timeout": 99999})
    assert captured["http_timeout"] == mcp_server._HTTP_TIMEOUT + mcp_server.MAX_WAIT_SECONDS
    # 非 wait 工具不叠加
    mcp_server.call_tool("list_agents", {})
    assert captured["http_timeout"] is None


def test_host_from_client_info():
    assert mcp_server.host_from_client_info({"name": "codex"}) == "codex"
    assert mcp_server.host_from_client_info({"name": "claude-ai"}) == "claude"
    assert mcp_server.host_from_client_info({"name": "omp"}) == "omp"
    assert mcp_server.host_from_client_info({"name": "some-other-app"}) == "unknown"
    assert mcp_server.host_from_client_info(None) == "unknown"


# ---- tools/call 映射与会话 ----

def test_tools_call_maps_to_daemon_path_and_injects_session(monkeypatch):
    captured = {}

    def fake_post(path, payload, http_timeout=None):
        captured["path"] = path
        captured["payload"] = payload
        captured["http_timeout"] = http_timeout
        return {"status": "running", "agent_id": 7}

    monkeypatch.setattr(mcp_server, "_daemon_post", fake_post)
    out = []
    mcp_server.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                       "params": {"name": "spawn_agent",
                                  "arguments": {"target_cli": "claude", "prompt": "hi"}}},
                      emit=out.append)
    msg = out[0]
    assert msg["id"] == 2
    assert captured["path"] == "/api/agents/spawn"
    assert captured["payload"]["session_id"].startswith("unknown-")
    body = json.loads(msg["result"]["content"][0]["text"])
    assert body["status"] == "running"


def test_session_id_persists_across_calls(monkeypatch):
    captured = []

    def fake_post(path, payload, http_timeout=None):
        captured.append(payload)
        return {"status": "ok"}

    monkeypatch.setattr(mcp_server, "_daemon_post", fake_post)
    mcp_server.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                       "params": {"clientInfo": {"name": "codex"}}}, emit=lambda m: None)
    mcp_server.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                       "params": {"name": "spawn_agent",
                                  "arguments": {"target_cli": "claude", "prompt": "a"}}},
                      emit=lambda m: None)
    mcp_server.handle({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                       "params": {"name": "wait_agent", "arguments": {"agent_id": 1}}},
                      emit=lambda m: None)
    assert captured[0]["session_id"].startswith("codex-")
    assert captured[0]["session_id"] == captured[1]["session_id"]


def test_session_id_uses_host_env_var_when_present(monkeypatch):
    """宿主注入稳定会话标识时优先使用：同一对话 resume 后 session_id 不变。"""
    monkeypatch.setenv("CLAUDE_CODE_SESSION_ID", "conv-abc-123")
    mcp_server.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                       "params": {"clientInfo": {"name": "claude"}}}, emit=lambda m: None)
    assert mcp_server._session_id() == "claude-conv-abc-123"
    # 模拟进程重启：清掉缓存后仍得同一 id（env 由宿主注入，重启不变）
    mcp_server._SESSION_ID = None
    assert mcp_server._session_id() == "claude-conv-abc-123"


def test_session_id_persisted_fallback_across_restarts(monkeypatch):
    """无宿主标识时持久化兜底：进程重启后仍取同一 session_id。"""
    first = mcp_server._session_id()
    assert first.startswith("unknown-")
    # 模拟 MCP 进程重启（新进程新内存）：仅持久化文件保留
    monkeypatch.setattr(mcp_server, "_SESSION_ID", None)
    second = mcp_server._session_id()
    assert second == first


def test_list_agents_include_other_sessions_passes_none(monkeypatch):
    """include_other_sessions=true 时 session_id 置 None（daemon 返回所有会话）；缺省注入当前会话。"""
    captured = []

    def fake_post(path, payload, http_timeout=None):
        captured.append(payload)
        return {"status": "ok", "agents": []}

    monkeypatch.setattr(mcp_server, "_daemon_post", fake_post)
    mcp_server.call_tool("list_agents", {"include_other_sessions": True})
    assert captured[0]["session_id"] is None
    assert "include_other_sessions" not in captured[0]
    mcp_server.call_tool("list_agents", {})
    assert captured[1]["session_id"] is not None


def test_daemon_structured_error_marks_is_error(monkeypatch):
    monkeypatch.setattr(mcp_server, "_daemon_post",
                        lambda path, payload, http_timeout=None: {"status": "error",
                                                                  "summary": "daemon returned HTTP 401",
                                                                  "root_cause_hint": "bad token",
                                                                  "next_actions": ["check token"]})
    out = []
    mcp_server.handle({"jsonrpc": "2.0", "id": 4, "method": "tools/call",
                       "params": {"name": "interrupt_agent",
                                  "arguments": {"agent_id": 1}}}, emit=out.append)
    msg = out[0]
    assert msg["result"]["isError"] is True
    body = json.loads(msg["result"]["content"][0]["text"])
    assert body["status"] == "error"
    assert body["next_actions"]


def test_unknown_tool_rpc_error():
    out = []
    mcp_server.handle({"jsonrpc": "2.0", "id": 5, "method": "tools/call",
                       "params": {"name": "nope", "arguments": {}}}, emit=out.append)
    msg = out[0]
    assert "error" in msg
    assert msg["error"]["code"] == -32602


# ---- ensure_daemon 原子拉起 ----

def _stub_request_daemon(monkeypatch, script):
    """桩掉 mcp_server._request_daemon：script 为按调用顺序弹出的
    (status, body_dict) 或 Exception 实例；返回 calls 记录 (method, path, token)。"""
    calls = []
    seq = list(script)

    def fake(method, port, path, *, token=None, payload=None, timeout=None):
        calls.append((method, path, token))
        item = seq.pop(0) if seq else (200, {})
        if isinstance(item, Exception):
            raise item
        status, body = item
        return status, json.dumps(body).encode("utf-8")

    monkeypatch.setattr(mcp_server, "_request_daemon", fake)
    return calls


def _write_probe_token(monkeypatch, tmp_path, token="probe-token"):
    daemon_json = tmp_path / "daemon.json"
    daemon_json.write_text(json.dumps({"token": token}), encoding="utf-8")
    monkeypatch.setattr(mcp_server, "DAEMON_JSON", daemon_json)
    return token


def test_probe_accepts_current_daemon_identity(monkeypatch, tmp_path):
    token = _write_probe_token(monkeypatch, tmp_path)
    fingerprint = mcp_server.hashlib.sha256(token.encode("utf-8")).hexdigest()
    calls = _stub_request_daemon(monkeypatch, [
        (200, {"ok": True, "service": "agent-mcp-daemon",
               "token_sha256": fingerprint}),
    ])

    assert mcp_server._probe(8765)
    assert calls == [("GET", "/health", None)]


def test_probe_accepts_legacy_daemon_only_after_authenticated_read(monkeypatch, tmp_path):
    token = _write_probe_token(monkeypatch, tmp_path)
    calls = _stub_request_daemon(monkeypatch, [
        (200, {"ok": True, "version": 1}),
        (200, {"agents": []}),
    ])

    assert mcp_server._probe(8765)
    assert calls[0] == ("GET", "/health", None)
    method, path, used_token = calls[1]
    assert (method, path) == ("POST", "/api/agents/list")
    assert used_token == token


def test_probe_rejects_legacy_health_when_authenticated_read_fails(monkeypatch, tmp_path):
    _write_probe_token(monkeypatch, tmp_path, token="wrong-token")
    calls = _stub_request_daemon(monkeypatch, [
        (200, {"ok": True, "version": 1}),
        OSError("unauthorized"),
    ])

    assert not mcp_server._probe(8765)
    assert len(calls) == 2


def test_probe_rejects_unrecognized_health_without_auth_fallback(monkeypatch, tmp_path):
    _write_probe_token(monkeypatch, tmp_path)
    calls = _stub_request_daemon(monkeypatch, [
        (200, {"ok": True, "version": 2, "service": "other"}),
    ])

    assert not mcp_server._probe(8765)
    assert len(calls) == 1


def test_probe_rejects_new_health_with_wrong_fingerprint(monkeypatch, tmp_path):
    """新契约下 token 无效：service 正确但 token_sha256 与本地 token 不符
    （另一 token 的 daemon）→ 立即拒绝，不回退认证探测。"""
    _write_probe_token(monkeypatch, tmp_path, token="real-token")
    calls = _stub_request_daemon(monkeypatch, [
        (200, {"ok": True, "service": "agent-mcp-daemon",
               "token_sha256": mcp_server.hashlib.sha256(b"other-token").hexdigest()}),
    ])

    assert not mcp_server._probe(8765)
    assert len(calls) == 1  # 指纹不匹配即拒绝，不做多余请求


def test_probe_rejects_wrong_service_with_matching_fingerprint(monkeypatch, tmp_path):
    """service 声明为其它服务（即使带匹配指纹）→ 拒绝。"""
    token = _write_probe_token(monkeypatch, tmp_path)
    fingerprint = mcp_server.hashlib.sha256(token.encode("utf-8")).hexdigest()
    _stub_request_daemon(monkeypatch, [
        (200, {"ok": True, "service": "some-other-service",
               "token_sha256": fingerprint}),
    ])

    assert not mcp_server._probe(8765)


def test_ensure_daemon_probe_alive(monkeypatch, tmp_path):
    monkeypatch.setattr(mcp_server, "STATE_DIR", tmp_path)
    monkeypatch.setattr(mcp_server, "DAEMON_JSON", tmp_path / "daemon.json")
    monkeypatch.setattr(mcp_server, "DAEMON_PORT", 8765)
    spawned = []

    def fake_spawn(cmd, **kw):
        spawned.append(cmd)

    monkeypatch.setattr(mcp_server, "_probe", lambda base: True)
    monkeypatch.setattr(mcp_server, "_spawn_detached", fake_spawn)
    port, token = mcp_server.ensure_daemon()
    assert port == 8765
    assert spawned == []  # 已存活，不拉起


def test_ensure_daemon_concurrent_calls_spawn_once(monkeypatch, tmp_path):
    """并发启动：多线程同时 ensure_daemon 且 daemon 未起 → 只拉起一个，
    所有调用者拿到同一 (base, token)。"""
    state_dir = tmp_path / "state"
    spawned = []
    alive = {"flag": False}

    def fake_probe(base):
        return alive["flag"]

    def fake_spawn(cmd, **kw):
        spawned.append(cmd)
        alive["flag"] = True  # 拉起后视为存活

    monkeypatch.setattr(mcp_server, "STATE_DIR", state_dir)
    monkeypatch.setattr(mcp_server, "DAEMON_JSON", state_dir / "daemon.json")
    monkeypatch.setattr(mcp_server, "DAEMON_SCRIPT", tmp_path / "daemon_main.py")
    monkeypatch.setattr(mcp_server, "DAEMON_PORT", 8765)
    monkeypatch.setattr(mcp_server, "_probe", fake_probe)
    monkeypatch.setattr(mcp_server, "_spawn_detached", fake_spawn)

    results = []
    errors = []

    def run():
        try:
            results.append(mcp_server.ensure_daemon())
        except Exception as exc:  # pragma: no cover
            errors.append(exc)

    threads = [threading.Thread(target=run) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)
    assert errors == []
    assert len(spawned) == 1  # 锁串行化：只拉起一次
    assert len(results) == 4
    assert len({r for r in results}) == 1  # 同一 (base, token)


def test_ensure_daemon_spawns_when_down_and_writes_token(monkeypatch, tmp_path):
    state_dir = tmp_path / "state"
    spawned = []
    monkeypatch.setattr(mcp_server, "STATE_DIR", state_dir)
    monkeypatch.setattr(mcp_server, "DAEMON_JSON", state_dir / "daemon.json")
    monkeypatch.setattr(mcp_server, "DAEMON_SCRIPT", tmp_path / "daemon_main.py")
    monkeypatch.setattr(mcp_server, "DAEMON_PORT", 8765)
    probes = iter([False, False, True, True])  # 首次探测失败触发 spawn，随后存活
    monkeypatch.setattr(mcp_server, "_probe", lambda base: next(probes))

    def fake_spawn(cmd, **kw):
        spawned.append(cmd)

    monkeypatch.setattr(mcp_server, "_spawn_detached", fake_spawn)
    port, token = mcp_server.ensure_daemon()
    assert port == 8765
    assert len(spawned) == 1
    cmd = spawned[0]
    assert any("daemon_main.py" in c for c in cmd)
    assert "--port" in cmd and "8765" in cmd
    assert (state_dir / "daemon.json").is_file()
    assert token == json.loads((state_dir / "daemon.json").read_text())["token"]


def test_ensure_daemon_fails_after_timeout(monkeypatch, tmp_path):
    monkeypatch.setattr(mcp_server, "STATE_DIR", tmp_path)
    monkeypatch.setattr(mcp_server, "DAEMON_JSON", tmp_path / "daemon.json")
    monkeypatch.setattr(mcp_server, "DAEMON_SCRIPT", tmp_path / "daemon_main.py")
    spawned = []

    def fake_spawn(cmd, **kw):
        spawned.append(cmd)

    monkeypatch.setattr(mcp_server, "_probe", lambda base: False)
    monkeypatch.setattr(mcp_server, "_spawn_detached", fake_spawn)
    monkeypatch.setattr(mcp_server.time, "sleep", lambda s: None)  # 加速
    with pytest.raises(RuntimeError, match="failed to start"):
        mcp_server.ensure_daemon()
    assert len(spawned) == 1  # 只拉起一次


def test_ensure_daemon_reuses_existing_token(monkeypatch, tmp_path):
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    (state_dir / "daemon.json").write_text(json.dumps({"token": "keepme"}))
    monkeypatch.setattr(mcp_server, "STATE_DIR", state_dir)
    monkeypatch.setattr(mcp_server, "DAEMON_JSON", state_dir / "daemon.json")
    monkeypatch.setattr(mcp_server, "_probe", lambda base: True)
    _, token = mcp_server.ensure_daemon()
    assert token == "keepme"


# ---- _daemon_post 重试与错误 ----

def test_daemon_post_retries_after_connection_failure(monkeypatch):
    calls = []

    def fake_post_once(base, token, path, payload, http_timeout=None):
        calls.append((base, token))
        return None if len(calls) == 1 else {"status": "ok"}

    monkeypatch.setattr(mcp_server, "_post_once", fake_post_once)
    monkeypatch.setattr(mcp_server, "ensure_daemon", lambda: ("http://x", "t"))
    out = mcp_server._daemon_post("/api/agents/spawn", {})
    assert out == {"status": "ok"}
    assert len(calls) == 2


def test_daemon_post_http_error_structured(monkeypatch):
    monkeypatch.setattr(mcp_server, "_post_once",
                        lambda base, token, path, payload, http_timeout=None:
                        {"status": "error", "summary": "daemon returned HTTP 401",
                         "next_actions": ["check the daemon log and auth token"]})
    monkeypatch.setattr(mcp_server, "ensure_daemon", lambda: ("http://x", "t"))
    out = mcp_server._daemon_post("/api/agents/spawn", {})
    assert out["status"] == "error"


def test_http_error_payload_gives_respawn_guidance_for_session_mismatch():
    # fixture 来自 daemon 真实错误消息（_require_session 抛出的 ValueError），
    # 锁住 daemon 文案 ↔ MCP 检测的双端契约，防任一侧改写后静默失效。
    from agent_mcp.daemon_main import Dispatcher

    with pytest.raises(ValueError) as exc_info:
        Dispatcher._require_session({"session_id": "codex-new"},
                                    {"id": 119, "session_id": "codex-old"})
    out = mcp_server._http_error_payload(
        400, json.dumps({"error": str(exc_info.value)}))
    assert out["status"] == "error"
    assert mcp_server.SESSION_MISMATCH_MARK in out["summary"]
    assert "spawn a NEW agent" in " ".join(out["next_actions"])
    assert "reuse this agent_id" in " ".join(out["next_actions"])


def test_http_error_payload_generic_for_other_errors():
    out = mcp_server._http_error_payload(500, '{"error": "boom"}')
    assert out["next_actions"] == ["check the arguments and the daemon log"]


def test_main_reads_stdin_lines(monkeypatch, capsys):
    lines = iter([
        json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}),
        "not-json\n",
        json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}),
    ])
    monkeypatch.setattr(mcp_server.sys, "stdin", lines)
    assert mcp_server.main() == 0
    out = capsys.readouterr().out
    assert '"serverInfo"' in out
    assert '"tools"' in out
    assert out.count("\n") == 2  # 非 JSON 行被跳过，只响应两条


def test_daemon_post_first_ensure_protected(monkeypatch):
    """_daemon_post 首次 ensure_daemon() 失败 → 返回结构化错误，不抛异常崩溃进程。"""
    calls = []
    monkeypatch.setattr(mcp_server, "ensure_daemon",
                        lambda: (_ for _ in ()).throw(RuntimeError("daemon down")))
    monkeypatch.setattr(mcp_server, "_post_once",
                        lambda *a, **kw: calls.append("unreachable"))
    out = mcp_server._daemon_post("/api/agents/list", {})
    assert out["status"] == "error"
    assert "not reachable" in out["summary"] or "unreachable" in out["summary"]
    assert len(calls) == 0  # ensure_daemon 失败，_post_once 未被调用


def test_handle_tools_call_ensure_fails_returns_error(monkeypatch):
    """tools/call 时 ensure_daemon 失败 → handle() 返回 JSON-RPC 错误，不崩溃进程。"""
    def fail_ensure():
        raise RuntimeError("daemon unreachable")
    monkeypatch.setattr(mcp_server, "_daemon_post",
                        lambda path, payload, http_timeout=None: (
                            {"status": "error",
                             "summary": "agent-mcp daemon is not reachable",
                             "root_cause_hint": "daemon unreachable",
                             "next_actions": ["start daemon"]}
                        ))
    monkeypatch.setattr(mcp_server, "ensure_daemon", fail_ensure)
    out = []
    mcp_server.handle({"jsonrpc": "2.0", "id": 5, "method": "tools/call",
                       "params": {"name": "list_agents", "arguments": {}}},
                      emit=out.append)
    msg = out[0]
    assert "error" not in msg  # 不是 JSON-RPC error（协议层正常）
    assert msg["result"]["isError"] is True
    body = json.loads(msg["result"]["content"][0]["text"])
    assert body["status"] == "error"


def test_main_handle_exception_does_not_crash(monkeypatch, capsys):
    """main() 中 handle() 抛出异常 → 进程不退出，stderr 写诊断。"""
    def crashing_handle(request, *, emit=mcp_server.send):
        raise ValueError("simulated crash in handle")

    monkeypatch.setattr(mcp_server, "handle", crashing_handle)
    lines = iter([
        json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}),
    ])
    monkeypatch.setattr(mcp_server.sys, "stdin", lines)
    # 不应抛出异常
    assert mcp_server.main() == 0
    err = capsys.readouterr().err
    assert "unhandled error" in err
    assert "simulated crash" in err


def test_main_fresh_process_lifecycle(monkeypatch, capsys):
    """fresh process 连续 initialize → tools/list → list_agents（daemon reachable）
    不提前关闭 stdout 管道。"""
    monkeypatch.setattr(mcp_server, "_daemon_post",
                        lambda path, payload, http_timeout=None: (
                            {"status": "ok", "agents": []}
                            if "/api/agents/list" in path
                            else {"status": "ok"}
                        ))
    lines = iter([
        json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "clientInfo": {"name": "codex-test"}}}),
        json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}),
        json.dumps({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                    "params": {"name": "list_agents", "arguments": {}}}),
    ])
    monkeypatch.setattr(mcp_server.sys, "stdin", lines)
    assert mcp_server.main() == 0
    out = capsys.readouterr().out
    assert '"serverInfo"' in out  # initialize 响应
    assert '"tools"' in out       # tools/list 响应
    assert 'agents' in out  # list_agents 响应（在 JSON 转义的 text 字段内）
    # 所有响应都是有效 JSON-RPC，每行一个
    for line in out.strip().split("\n"):
        msg = json.loads(line)
        assert "jsonrpc" in msg
        assert "id" in msg


def test_state_dir_prefers_agent_mcp_home_over_codex_home(monkeypatch):
    monkeypatch.delenv("AGENT_MCP_HOME", raising=False)
    monkeypatch.setenv("CODEX_HOME", "/tmp/codexhome")
    assert mcp_server.state_dir_from_env() == Path("/tmp/codexhome") / "agent-mcp"
    monkeypatch.setenv("AGENT_MCP_HOME", "/tmp/amh")
    assert mcp_server.state_dir_from_env() == Path("/tmp/amh") / "agent-mcp"


# ---- 2025-11-25 协商后 tools/call 的 modern 结果 ----

def test_2025_11_25_tools_call_has_structured_content(monkeypatch):
    """2025-11-25 客户端（DSH）协商后：tools/call 结果带 structuredContent 与 resultType，
    且普通工具（非 spawn+task）不返回 task handle。"""
    monkeypatch.setattr(mcp_server, "call_tool", lambda name, args: {
        "status": "ok", "level": "S", "rationale": "单文件小改"})
    out = []
    mcp_server.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                       "params": {"protocolVersion": "2025-11-25",
                                  "clientInfo": {"name": "dsh-mcp-client"},
                                  "capabilities": {}}}, emit=out.append)
    assert out[0]["result"]["protocolVersion"] == "2025-11-25"
    out.clear()
    mcp_server.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                       "params": {"name": "estimate_complexity",
                                  "arguments": {"task": "小改"}}}, emit=out.append)
    result = out[0]["result"]
    assert result["resultType"] == "complete"
    assert result["structuredContent"] == {"status": "ok", "level": "S",
                                           "rationale": "单文件小改"}
    assert "taskId" not in result  # 未声明 tasks 能力 → 普通结果路径
    assert result["_meta"]["io.modelcontextprotocol/serverInfo"]["name"] == "agent-mcp"


def test_2025_11_25_tools_call_error_still_marks_is_error(monkeypatch):
    """2025-11-25 下 daemon 错误仍走 isError=true（DSH 桥接层依赖该语义抛错）。"""
    monkeypatch.setattr(mcp_server, "_daemon_post",
                        lambda path, payload, http_timeout=None: {
                            "status": "error", "summary": "boom",
                            "next_actions": ["check"]})
    out = []
    mcp_server.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                       "params": {"protocolVersion": "2025-11-25"}}, emit=out.append)
    out.clear()
    mcp_server.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                       "params": {"name": "interrupt_agent",
                                  "arguments": {"agent_id": 1}}}, emit=out.append)
    result = out[0]["result"]
    assert result["isError"] is True
    assert result["structuredContent"]["status"] == "error"
