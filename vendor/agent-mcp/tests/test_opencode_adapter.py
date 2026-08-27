import json
import pytest
from agent_mcp.cli_adapters import get_adapter

# fixture 基于 opencode 1.14.51 `run --format json` 实测输出裁剪
# （2026-08-03 实测：事件仅 step_start/text/tool_use/step_finish 四种，
#  usage 在 step_finish.part.tokens{input,output,reasoning,cache{read,write}} + cost，
#  所有事件带顶层 sessionID）

OPC_TEXT = {
    "type": "text", "timestamp": 1785688865945, "sessionID": "ses_1",
    "part": {"id": "prt_2", "messageID": "msg_1", "sessionID": "ses_1",
             "type": "text", "text": "working"},
}

OPC_TOOL = {
    "type": "tool_use", "timestamp": 1785688662423, "sessionID": "ses_1",
    "part": {"type": "tool", "tool": "bash", "callID": "call_1",
             "state": {"status": "completed", "input": {"command": "ls"},
                       "output": "file1\nfile2"}},
}

OPC_STEP_FINISH = {
    "type": "step_finish", "timestamp": 1785688720439, "sessionID": "ses_1",
    "part": {"id": "prt_3", "messageID": "msg_1", "sessionID": "ses_1",
             "type": "step-finish", "reason": "tool-calls",
             "tokens": {"total": 100, "input": 90, "output": 10,
                        "reasoning": 5, "cache": {"write": 0, "read": 20}},
             "cost": 0.3},
}

OPC_STEP_START = {
    "type": "step_start", "timestamp": 1785687738031, "sessionID": "ses_1",
    "part": {"id": "prt_1", "messageID": "msg_1", "sessionID": "ses_1",
             "type": "step-start"},
}

def test_opencode_command():
    a = get_adapter("opencode")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model=None,
                          permission_mode="acceptEdits", max_turns=8, resume=None)
    assert cmd[0].endswith("opencode")
    assert "run" in cmd
    assert "--format" in cmd and "json" in cmd

def test_opencode_command_full_access():
    a = get_adapter("opencode")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model="x",
                          permission_mode="fullAccess", max_turns=8, resume=None)
    assert "--dangerously-skip-permissions" in cmd

def test_opencode_command_model_and_dir():
    a = get_adapter("opencode")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model="opencodex/gpt-5.6-luna",
                          permission_mode="plan", max_turns=8, resume=None)
    assert "--dir" in cmd and "/tmp" in cmd
    assert "--model" in cmd and "opencodex/gpt-5.6-luna" in cmd

def test_opencode_parse_events():
    a = get_adapter("opencode")
    lines = [json.dumps(OPC_STEP_START), json.dumps(OPC_TEXT),
             json.dumps(OPC_TOOL), json.dumps(OPC_STEP_FINISH)]
    events, usage = a.parse_stream(lines)
    msgs = [e for e in events if e["type"] == "agent.message"]
    tools = [e for e in events if e["type"] == "agent.tool_use"]
    assert msgs and "working" in msgs[0]["payload"]["text"]
    assert tools and tools[0]["payload"]["name"] == "bash"
    assert tools[0]["payload"]["input"].get("command") == "ls"
    assert usage["input_tokens"] == 90
    assert usage["output_tokens"] == 10
    assert usage["cache_read"] == 20
    assert usage["reasoning_tokens"] == 5
    assert usage["cost_usd"] == 0.3

def test_opencode_session_extracted():
    a = get_adapter("opencode")
    assert a.extract_session_id(OPC_TEXT) == "ses_1"


def test_opencode_terminated_carries_session_id():
    """P1/P5: parse_stream 末尾产出一条带 session_id 的 terminated，
    daemon _ingest_output 据此回填 cli_session_id（opencode resume 链路）。"""
    a = get_adapter("opencode")
    lines = [json.dumps(OPC_STEP_START), json.dumps(OPC_TEXT),
             json.dumps(OPC_STEP_FINISH)]
    events, _ = a.parse_stream(lines)
    terminated = [e for e in events if e["type"] == "agent.terminated"]
    assert len(terminated) == 1
    assert terminated[0]["payload"]["session_id"] == "ses_1"


def test_opencode_no_terminated_without_session():
    """无 sessionID 事件时（畸形/空输出）不产伪 terminated。"""
    a = get_adapter("opencode")
    events, _ = a.parse_stream(["", "not-json{"])
    assert not any(e["type"] == "agent.terminated" for e in events)

def test_opencode_parse_tolerates_malformed_lines():
    a = get_adapter("opencode")
    lines = ["", "not-json{", '["a"]', "null", '{"type":"text","part":']
    events, usage = a.parse_stream(lines)
    assert events == []  # 无事件
    # 畸形/空输入不产生伪 usage：与 claude 同语义返回 {}（daemon `if usage:` 跳过）
    assert usage == {}

def test_unknown_cli_rejected():
    with pytest.raises(ValueError):
        get_adapter("nonexistent")
