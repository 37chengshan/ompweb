import json
import pytest
from agent_mcp.cli_adapters import get_adapter

# fixture 基于 omp 17.2.4 `-p --mode=json` 实测输出裁剪
# （2026-08-03 实测：session/agent_start/turn_start/message_start/message_update
#  (text_delta)/message_end/turn_end/agent_end；usage 权威值在 assistant
#  message_end（message_start 为 0 占位），字段 camelCase + cost.total）

OMP_SESSION = {"type": "session", "version": 3, "id": "ses-1",
               "timestamp": "2026-08-02T16:42:20.323Z", "cwd": "/tmp"}

OMP_MSG_END = {
    "type": "message_end",
    "message": {"role": "assistant",
                "content": [{"type": "text", "text": "OK"}],
                "api": "openai-completions", "provider": "opencodex",
                "model": "deepseek/deepseek-v4-pro",
                "usage": {"input": 32, "output": 34, "cacheRead": 56832,
                          "cacheWrite": 0, "totalTokens": 56898,
                          "reasoningTokens": 32,
                          "cost": {"input": 0.0, "output": 0.0,
                                   "cacheRead": 0.0, "cacheWrite": 0.0,
                                   "total": 0.0078}},
                "stopReason": "stop", "responseId": "r1"},
}

OMP_TEXT_DELTA = {"type": "message_update", "assistantMessageEvent": {
    "type": "text_delta", "contentIndex": 0, "delta": "OK"}}

OMP_AGENT_END = {"type": "agent_end", "isTerminal": True, "messages": []}

def test_omp_command_headless():
    a = get_adapter("omp")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=8, resume=None)
    assert "--print" in cmd
    assert "--mode" in cmd and "json" in cmd
    assert "--cwd" in cmd and "/tmp" in cmd

def test_omp_command_full_access():
    a = get_adapter("omp")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model=None,
                          permission_mode="fullAccess", max_turns=8, resume=None)
    assert cmd[cmd.index("--approval-mode") + 1] == "yolo"
    assert "--auto-approve" in cmd

def test_omp_parse_message_and_usage():
    a = get_adapter("omp")
    events, usage = a.parse_stream([json.dumps(OMP_SESSION),
                                    json.dumps(OMP_MSG_END)])
    msgs = [e for e in events if e["type"] == "agent.message"]
    assert msgs and "OK" in msgs[0]["payload"]["text"]
    assert usage["input_tokens"] == 32
    assert usage["output_tokens"] == 34
    assert usage["cache_read"] == 56832
    assert usage["cache_creation"] == 0
    assert usage["reasoning_tokens"] == 32
    assert abs(usage["cost_usd"] - 0.0078) < 1e-9

def test_omp_parse_text_delta():
    a = get_adapter("omp")
    events, _ = a.parse_stream([json.dumps(OMP_TEXT_DELTA)])
    deltas = [e for e in events if e["type"] == "agent.message_delta"]
    assert deltas and deltas[0]["payload"]["delta"] == "OK"

def test_omp_multi_turn_usage_accumulates():
    # 实测（17.2.4 多 turn）：message_end.usage 为每 turn 增量（第二 turn
    # cacheRead 小于第一 turn 即非累计），双 message_end 应累加
    a = get_adapter("omp")
    end1 = {"type": "message_end", "message": {"role": "assistant",
            "content": [{"type": "text", "text": "a"}],
            "usage": {"input": 48, "output": 139, "cacheRead": 56832,
                      "cacheWrite": 0, "reasoningTokens": 10,
                      "cost": {"total": 0.008}}}}
    end2 = {"type": "message_end", "message": {"role": "assistant",
            "content": [{"type": "text", "text": "b"}],
            "usage": {"input": 21666, "output": 555, "cacheRead": 36608,
                      "cacheWrite": 0, "reasoningTokens": 100,
                      "cost": {"total": 0.041}}}}
    events, usage = a.parse_stream([json.dumps(end1), json.dumps(end2)])
    assert usage["input_tokens"] == 48 + 21666
    assert usage["output_tokens"] == 139 + 555
    assert usage["cache_read"] == 56832 + 36608
    assert usage["reasoning_tokens"] == 10 + 100
    assert abs(usage["cost_usd"] - (0.008 + 0.041)) < 1e-9

def test_omp_parse_tolerates_malformed_lines():
    a = get_adapter("omp")
    lines = ["", "not-json{", '["a"]', "null", '{"type":"message_end","message":']
    events, usage = a.parse_stream(lines)
    assert events == []  # 无事件
    # 畸形/空输入不产生伪 usage：与 claude 同语义返回 {}（daemon `if usage:` 跳过）
    assert usage == {}

def test_omp_parse_terminated():
    a = get_adapter("omp")
    events, _ = a.parse_stream([json.dumps(OMP_SESSION),
                                json.dumps(OMP_MSG_END),
                                json.dumps(OMP_AGENT_END)])
    terms = [e for e in events if e["type"] == "agent.terminated"]
    assert terms
    assert terms[0]["payload"]["session_id"] == "ses-1"
    assert terms[0]["payload"]["stop_reason"] == "stop"

def test_omp_session_extracted():
    a = get_adapter("omp")
    assert a.extract_session_id(OMP_SESSION) == "ses-1"

def test_unknown_cli_rejected():
    with pytest.raises(ValueError):
        get_adapter("nonexistent")
