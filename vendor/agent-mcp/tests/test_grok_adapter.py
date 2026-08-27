import json
import pytest
from agent_mcp.cli_adapters import get_adapter

# fixture 基于 grok 0.2.118 streaming-messages-json 实测输出裁剪
# （2026-08-03 实测：assistant 行 content 为 thinking/text 块数组，
#   result 行为 snake_case 字段，与 capability-matrix 记录的 camelCase 不同）

GROK_SYSTEM = {
    "type": "system", "subtype": "init", "session_id": "s-grok-1",
    "apiKeySource": "user", "model": "ocx-jbb-grok-4-5", "cwd": "/private/tmp",
    "permissionMode": "bypassPermissions",
}

GROK_MSG = {
    "type": "assistant",
    "message": {
        "id": "msg_0", "type": "message", "role": "assistant",
        "model": "ocx-jbb-grok-4-5",
        "content": [{"type": "thinking", "thinking": "..."},
                    {"type": "text", "text": "hi"}],
        "stop_reason": "end_turn", "stop_sequence": None,
        "usage": {"input_tokens": 10, "output_tokens": 5,
                  "cache_read_input_tokens": 2, "cache_creation_input_tokens": 0},
    },
    "parent_tool_use_id": None, "session_id": "s-grok-1", "uuid": "u1",
}

GROK_RESULT = {
    "type": "result", "subtype": "success", "is_error": False,
    "duration_ms": 78379, "num_turns": 1, "result": "OK",
    "stop_reason": "end_turn", "total_cost_usd": 0.42,
    "usage": {"input_tokens": 100, "output_tokens": 20,
              "cache_read_input_tokens": 50, "cache_creation_input_tokens": 0,
              "server_tool_use": {"web_search_requests": 0}},
    "modelUsage": {"jbb/grok-4.5": {"inputTokens": 100, "outputTokens": 20,
                                    "cacheReadInputTokens": 50, "costUSD": 0.42}},
    "session_id": "s-grok-1", "uuid": "u2",
}

def test_grok_command_uses_single_and_streaming():
    a = get_adapter("grok")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model="ocx-jbb-grok-4-5",
                          permission_mode="fullAccess", max_turns=10, resume=None)
    assert "--single" in cmd
    assert "--output-format" in cmd
    assert "streaming-messages-json" in cmd
    assert "--permission-mode" in cmd and "bypassPermissions" in cmd
    assert "--always-approve" in cmd
    assert "--max-turns" in cmd and "10" in cmd

def test_grok_command_plan_mode_no_approve():
    a = get_adapter("grok")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=10, resume=None)
    assert "--permission-mode" in cmd and "plan" in cmd
    assert "--no-subagents" in cmd  # plan 模式禁用子代理
    assert "--always-approve" not in cmd

def test_grok_parse_message_extracts_text_from_blocks():
    a = get_adapter("grok")
    events, usage = a.parse_stream([json.dumps(GROK_MSG)])
    assert usage["input_tokens"] == 10
    assert usage["cache_read"] == 2
    msg_events = [e for e in events if e["type"] == "agent.message"]
    assert msg_events
    assert "hi" in msg_events[0]["payload"]["text"]

def test_grok_result_overrides_usage_and_terminated():
    a = get_adapter("grok")
    events, usage = a.parse_stream([json.dumps(GROK_MSG), json.dumps(GROK_RESULT)])
    assert usage["input_tokens"] == 100  # result 覆盖（与 claude 同语义）
    assert usage["cost_usd"] == 0.42
    terms = [e for e in events if e["type"] == "agent.terminated"]
    assert terms
    assert terms[0]["payload"]["session_id"] == "s-grok-1"
    assert terms[0]["payload"]["stop_reason"] == "end_turn"

def test_grok_system_init_session_extracted():
    a = get_adapter("grok")
    assert a.extract_session_id(GROK_SYSTEM) == "s-grok-1"

def test_grok_parse_tolerates_malformed_lines():
    a = get_adapter("grok")
    lines = ["", "not-json{", '["a"]', "null", '{"type":"assistant","message":']
    events, usage = a.parse_stream(lines)
    assert events == []  # 无事件
    # 畸形/空输入不产生伪 usage：与 claude 同语义返回 {}（daemon `if usage:` 跳过）
    assert usage == {}

def test_unknown_cli_rejected():
    with pytest.raises(ValueError):
        get_adapter("nonexistent")
