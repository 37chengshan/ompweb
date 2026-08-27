"""事件归一化 fixture 测试：11 个内置适配器的 parse_stream 统一断言。

fixture 来源：docs/capability-matrix.md 记录的实测结构与各适配器 docstring。
覆盖目标：任一适配器事件解析回归，上层（daemon/编排/策略）依赖的
归一化事件（agent.message / agent.tool_use / agent.usage / agent.terminated）
字段完整性。

约定：usage 归一化 5 元组 + 可选 reasoning_tokens：
  input_tokens / output_tokens / cache_creation / cache_read / cost_usd
"""
import json

import pytest

from agent_mcp.cli_adapters import get_adapter, adapter_names

ADAPTERS = ["claude", "grok", "opencode", "omp", "atomcode",
            "codex", "kimi", "copilot", "pi", "zcode", "cline"]


def parse(cli: str, lines: list[str]) -> tuple[list[dict], dict]:
    return get_adapter(cli).parse_stream(lines)


def jlines(*objs: dict) -> list[str]:
    return [json.dumps(o, ensure_ascii=False) for o in objs]


# ---------------------------------------------------------------------------
# claude / grok / kimi（同构：assistant/result 行，snake_case）
# ---------------------------------------------------------------------------

CLAUDE_RESULT = {
    "type": "result", "is_error": False, "stop_reason": "end_turn",
    "session_id": "s-abc", "total_cost_usd": 0.3,
    "usage": {"input_tokens": 100, "output_tokens": 20,
              "cache_creation_input_tokens": 0, "cache_read_input_tokens": 50},
    "modelUsage": {"m1": {"inputTokens": 100, "outputTokens": 20,
                          "cacheReadInputTokens": 50, "costUSD": 0.3}},
}


@pytest.mark.parametrize("cli", ["claude", "grok", "kimi"])
def test_claude_family_result_and_usage(cli):
    events, usage = parse(cli, jlines(CLAUDE_RESULT))
    assert usage["input_tokens"] == 100
    assert usage["output_tokens"] == 20
    assert usage["cache_read"] == 50
    assert usage["cost_usd"] == 0.3
    assert any(e["type"] == "agent.usage" for e in events)


@pytest.mark.parametrize("cli", ["claude", "grok", "kimi"])
def test_claude_family_assistant_message(cli):
    events, _ = parse(cli, jlines({
        "type": "assistant",
        "message": {"id": "m1", "content": [{"type": "text", "text": "你好"}]},
    }))
    assert any(e["type"] == "agent.message" and e["payload"]["text"] == "你好"
               for e in events)


# ---------------------------------------------------------------------------
# opencode（run --format json：text/tool_use/step_finish + 顶层 sessionID）
# ---------------------------------------------------------------------------

OPENCODE_STREAM = [
    {"type": "text", "sessionID": "oc-1",
     "part": {"type": "text", "text": "分析完成"}},
    {"type": "tool_use", "sessionID": "oc-1",
     "part": {"type": "tool", "tool": "bash",
              "state": {"input": {"command": "ls"}, "output": "a.txt"}}},
    {"type": "step_finish", "sessionID": "oc-1",
     "part": {"tokens": {"input": 50, "output": 10,
                         "cache": {"read": 20, "write": 5},
                         "reasoning": 3},
              "cost": 0.01}},
]


def test_opencode_text_tool_usage_and_session():
    events, usage = parse("opencode", jlines(*OPENCODE_STREAM))
    types = [e["type"] for e in events]
    assert types.count("agent.message") == 1
    assert types.count("agent.tool_use") == 1
    assert types.count("agent.usage") == 1
    assert usage["input_tokens"] == 50
    assert usage["output_tokens"] == 10
    assert usage["cache_read"] == 20
    assert usage["cache_creation"] == 5
    assert usage["cost_usd"] == 0.01
    # 末尾 terminated 仅带 session_id（供 daemon 回填 resume）
    term = [e for e in events if e["type"] == "agent.terminated"]
    assert term and term[-1]["payload"]["session_id"] == "oc-1"


# ---------------------------------------------------------------------------
# omp（--mode json：session/message_update/message_end/agent_end，camelCase）
# ---------------------------------------------------------------------------

OMP_STREAM = [
    {"type": "session", "id": "omp-7", "version": 1},
    {"type": "agent_start", "agent": "main"},
    {"type": "message_update",
     "assistantMessageEvent": {"type": "text_delta", "delta": "打字"}},
    {"type": "message_end", "message": {
        "content": [{"type": "text", "text": "最终回答"}],
        "stopReason": "end_turn",
        "usage": {"input": 30, "output": 8, "cacheRead": 12,
                  "cacheWrite": 0, "reasoningTokens": 2,
                  "cost": {"total": 0.05}}}},
    {"type": "agent_end", "isTerminal": True},
]


def test_omp_delta_message_usage_end():
    events, usage = parse("omp", jlines(*OMP_STREAM))
    assert any(e["type"] == "agent.message_delta" and e["payload"]["delta"] == "打字"
               for e in events)
    assert any(e["type"] == "agent.message" and e["payload"]["text"] == "最终回答"
               for e in events)
    assert usage["input_tokens"] == 30
    assert usage["output_tokens"] == 8
    assert usage["cache_read"] == 12
    assert usage["cost_usd"] == 0.05
    term = [e for e in events if e["type"] == "agent.terminated"]
    assert term and term[-1]["payload"]["stop_reason"] == "end_turn"
    assert term[-1]["payload"]["session_id"] == "omp-7"


# ---------------------------------------------------------------------------
# atomcode（文本捕获 + [tokens] 行）
# ---------------------------------------------------------------------------

ATOMCODE_LINES = [
    "[tokens] prompt=40 completion=9 cached=6",
    "输出文本 A",
    "[done]",
    "输出文本 B",
]


def test_atomcode_text_and_tokens_line():
    events, usage = parse("atomcode", ATOMCODE_LINES)
    texts = [e["payload"]["text"] for e in events if e["type"] == "agent.message"]
    assert any("输出文本 A" in t for t in texts)
    assert any("输出文本 B" in t for t in texts)
    assert usage["input_tokens"] == 46  # prompt + cached 计入 input
    assert usage["output_tokens"] == 9
    assert usage["cache_read"] == 6


# ---------------------------------------------------------------------------
# codex（exec --json：thread.started/item.completed/turn.completed）
# ---------------------------------------------------------------------------

CODEX_STREAM = [
    {"type": "thread.started", "thread_id": "th-42"},
    {"type": "item.completed", "item": {"type": "assistant_message", "text": "方案"}},
    {"type": "item.completed", "item": {"type": "command_execution",
                                        "command": "pwd", "output": "/repo"}},
    {"type": "turn.completed", "usage": {
        "input_tokens": 200, "cached_input_tokens": 60,
        "output_tokens": 30, "reasoning_output_tokens": 4}},
]


def test_codex_events_and_usage_mapping():
    events, usage = parse("codex", jlines(*CODEX_STREAM))
    assert any(e["type"] == "agent.message" and e["payload"]["text"] == "方案"
               for e in events)
    assert any(e["type"] == "agent.tool_use" and e["payload"]["name"] == "bash"
               for e in events)
    assert usage["input_tokens"] == 200
    assert usage["output_tokens"] == 30
    assert usage["cache_read"] == 60
    assert usage["reasoning_tokens"] == 4
    term = [e for e in events if e["type"] == "agent.terminated"]
    assert term and term[-1]["payload"]["session_id"] == "th-42"


def test_codex_turn_failed_yields_error_terminated():
    events, _ = parse("codex", jlines(
        {"type": "thread.started", "thread_id": "th-1"},
        {"type": "turn.failed", "error": {"message": "boom"}},
    ))
    term = [e for e in events if e["type"] == "agent.terminated"]
    assert term and term[-1]["payload"]["stop_reason"] == "error"


# ---------------------------------------------------------------------------
# copilot（文本捕获 + --resume= 摘要回填 session）
# ---------------------------------------------------------------------------

COPILOT_LINES = [
    "思考输出…",
    "另一行",
    "提示: 续接会话 copilot --resume=cp-9",
]


def test_copilot_text_capture_and_resume_hint():
    events, usage = parse("copilot", COPILOT_LINES)
    msgs = [e for e in events if e["type"] == "agent.message"]
    assert len(msgs) == 1
    assert "思考输出" in msgs[0]["payload"]["text"]
    term = [e for e in events if e["type"] == "agent.terminated"]
    assert term and term[-1]["payload"]["session_id"] == "cp-9"
    assert usage == {}


# ---------------------------------------------------------------------------
# pi（--mode json：session 首行 / message_end / agent_end）
# ---------------------------------------------------------------------------

PI_STREAM = [
    {"type": "session", "id": "pi-3", "version": 2, "cwd": "/repo"},
    {"type": "agent_start"},
    {"type": "message_end",
     "message": {"role": "assistant", "content": [{"type": "text", "text": "pi 回答"}]}},
    {"type": "agent_end"},
]


def test_pi_session_message_end():
    events, _ = parse("pi", jlines(*PI_STREAM))
    assert any(e["type"] == "agent.message" and e["payload"]["text"] == "pi 回答"
               for e in events)
    term = [e for e in events if e["type"] == "agent.terminated"]
    assert term and term[-1]["payload"]["session_id"] == "pi-3"
    assert term[-1]["payload"]["stop_reason"] == "end_turn"


# ---------------------------------------------------------------------------
# zcode / cline（降级模式：纯文本捕获）
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("cli", ["zcode", "cline"])
def test_text_capture_degraded_mode(cli):
    events, usage = parse(cli, ["行一", "  行二  ", ""])
    msgs = [e for e in events if e["type"] == "agent.message"]
    assert len(msgs) == 1
    assert "行一" in msgs[0]["payload"]["text"] and "行二" in msgs[0]["payload"]["text"]
    assert usage == {}


@pytest.mark.parametrize("cli", ["zcode", "cline"])
def test_text_capture_empty_input(cli):
    events, usage = parse(cli, ["", "   "])
    assert events == [] and usage == {}


# ---------------------------------------------------------------------------
# 全适配器注册完整性
# ---------------------------------------------------------------------------

def test_all_eleven_adapters_registered():
    registered = set(adapter_names())
    assert set(ADAPTERS) <= registered


def test_every_adapter_tolerates_garbage_lines():
    """所有适配器对空/畸形行必须容错（不抛异常、返回空事件）。"""
    garbage = ["", "not-json{", '["a"]', "null", '{"type":']
    for cli in ADAPTERS:
        events, usage = parse(cli, garbage)
        assert isinstance(events, list)
        assert isinstance(usage, dict)
