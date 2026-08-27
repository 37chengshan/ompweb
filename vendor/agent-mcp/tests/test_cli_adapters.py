import json
import subprocess
import pytest
from agent_mcp.cli_adapters import get_adapter, ClaudeAdapter

# fixture 来源：capability-matrix 记录的 claude 2.1.220 stream-json result 行结构
# （嵌套在 result 字段内；claude 侧未实测过原始输出，T4 起沿用此结构）
CLAUDE_RESULT = {
    "is_error": False, "stop_reason": "end_turn", "session_id": "s-abc",
    "total_cost_usd": 0.3,
    "usage": {"input_tokens": 100, "output_tokens": 20,
              "cache_creation_input_tokens": 0, "cache_read_input_tokens": 50},
    "modelUsage": {"m1": {"inputTokens": 100, "outputTokens": 20,
                          "cacheReadInputTokens": 50, "costUSD": 0.3}},
}

def test_claude_adapter_builds_command():
    a = get_adapter("claude")
    cmd = a.build_command(prompt="hi", cwd="/tmp", model="x",
                          permission_mode="plan", max_turns=5, resume=None)
    assert "--output-format" in cmd and "stream-json" in cmd
    assert "--permission-mode" in cmd and "plan" in cmd
    # claude 2.1.220 不支持 --cwd（实测 unknown option），工作目录由 subprocess 层覆盖
    assert "--cwd" not in cmd

@pytest.mark.integration
@pytest.mark.skipif(ClaudeAdapter().binary() is None, reason="claude CLI not installed")
def test_claude_real_spawn_smoke():
    """真实跑 claude -p 冒烟：命令可执行、stream-json 输出可解析（不断言 AI 内容）。"""
    a = get_adapter("claude")
    cmd = a.build_command(prompt="回复 OK", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=1, resume=None)
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr[-500:]
    parsed = [json.loads(l) for l in proc.stdout.splitlines() if l.strip()]
    assert any(d.get("type") in ("assistant", "result") for d in parsed)

def test_claude_parse_stream_extracts_usage():
    a = get_adapter("claude")
    lines = [json.dumps({"type": "result", "result": CLAUDE_RESULT})]
    events, usage = a.parse_stream(lines)
    assert usage["input_tokens"] == 100
    assert usage["cost_usd"] == 0.3
    assert any(e["type"] == "agent.usage" for e in events)


def test_claude_parse_top_level_result():
    """claude 2.1.220 实测（T14 对账）：result 行是顶层结构——is_error/stop_reason/
    usage/modelUsage 与 type 平级（与 grok 同构），而非 T4 fixture 的嵌套假设；
    适配器须兼容两种结构（顶层时 output/cost 不再丢失）。"""
    a = get_adapter("claude")
    lines = [json.dumps({"type": "result", "is_error": False, "stop_reason": "end_turn",
                         "session_id": "s-top", "total_cost_usd": 0.5,
                         "usage": {"input_tokens": 200, "output_tokens": 10,
                                   "cache_creation_input_tokens": 0,
                                   "cache_read_input_tokens": 50}})]
    events, usage = a.parse_stream(lines)
    assert usage["input_tokens"] == 200
    assert usage["output_tokens"] == 10
    assert usage["cache_read"] == 50
    assert usage["cost_usd"] == 0.5
    assert any(e["type"] == "agent.usage" for e in events)

def test_claude_parse_dedupe_by_message_id():
    a = get_adapter("claude")
    lines = [
        json.dumps({"type": "assistant", "message": {"id": "m1", "content": "a",
                    "usage": {"input_tokens": 5, "output_tokens": 1}}}),
        json.dumps({"type": "assistant", "message": {"id": "m1", "content": "b",
                    "usage": {"input_tokens": 5, "output_tokens": 1}}}),
        json.dumps({"type": "result", "result": CLAUDE_RESULT}),
    ]
    events, usage = a.parse_stream(lines)
    assert usage["input_tokens"] == 100  # result 覆盖，assistant 同 id 不重复累加

def test_claude_parse_message_events():
    a = get_adapter("claude")
    lines = [json.dumps({"type": "assistant", "message": {"id": "m1", "content": "hi"}})]
    events, _ = a.parse_stream(lines)
    assert any(e["type"] == "agent.message" for e in events)

def test_claude_parse_tolerates_malformed_lines():
    a = get_adapter("claude")
    lines = ["", "not-json{", '["a"]', "null", '{"type":"assistant","message":']
    events, usage = a.parse_stream(lines)
    assert events == [] and usage == {}

def test_unknown_cli_rejected():
    with pytest.raises(ValueError):
        get_adapter("nonexistent")
