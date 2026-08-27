import json
import pytest
from pathlib import Path

from agent_mcp.cli_adapters import (GenericAdapter, get_adapter, load_custom_adapters,
                                    adapter_names)

# GenericAdapter：配置驱动的通用适配器（docs/custom-cli.md 模板）。
# jsonl 模式 fixture 仿 claude stream-json 结构；text 模式仿 atomcode [tokens] 行。

JSONL_CFG = {
    "cli_name": "mycli",
    "bins": ["mycli"],
    "command": {
        "prefix": ["-p", "--output-format", "stream-json", "{cwd}"],
        "permission_flags": {
            "plan": ["--permission-mode", "plan"],
            "acceptEdits": ["--permission-mode", "acceptEdits"],
            "fullAccess": ["--dangerously-skip-permissions"],
        },
        "model_flag": ["--model", "{value}"],
        "resume_flag": ["--resume", "{value}"],
    },
    "parse": {
        "mode": "jsonl",
        "event_field": "type",
        "message_types": ["assistant"],
        "message_text_path": "message.content",
        "result_types": ["result"],
        "usage_path": "usage",
        "cost_path": "total_cost_usd",
        "session_id_path": "session_id",
        "stop_reason_path": "stop_reason",
    },
}

TEXT_CFG = {
    "cli_name": "textcli",
    "bins": ["textcli"],
    "parse": {
        "mode": "text",
        "skip_prefixes": ["[tokens]", "[done]"],
        "usage_regex": r"\[tokens\]\s+prompt=(?P<input_tokens>\d+)\s+"
                       r"completion=(?P<output_tokens>\d+)\s+cached=(?P<cache_read>\d+)",
    },
}


def test_generic_jsonl_command(monkeypatch):
    a = GenericAdapter(JSONL_CFG)
    monkeypatch.setattr(a, "binary", lambda: "/bin/mycli")
    cmd = a.build_command(prompt="hi", cwd="/tmp", model="m1",
                          permission_mode="plan", max_turns=8, resume=None)
    assert cmd[0] == "/bin/mycli"
    assert "-p" in cmd and "stream-json" in cmd
    assert "/tmp" in cmd  # {cwd} 占位替换
    assert "--model" in cmd and "m1" in cmd
    assert cmd[-1] == "hi"


def test_generic_jsonl_command_permissions(monkeypatch):
    a = GenericAdapter(JSONL_CFG)
    monkeypatch.setattr(a, "binary", lambda: "/bin/mycli")
    cmd = a.build_command(prompt="hi", cwd="/tmp", model=None,
                          permission_mode="fullAccess", max_turns=8, resume=None)
    assert "--dangerously-skip-permissions" in cmd


def test_generic_jsonl_parse():
    a = GenericAdapter(JSONL_CFG)
    lines = [
        json.dumps({"type": "assistant",
                    "message": {"id": "m1", "content": [{"type": "text", "text": "gen 输出"}]}}),
        json.dumps({"type": "result", "session_id": "s-1", "stop_reason": "end_turn",
                    "total_cost_usd": 0.2,
                    "usage": {"input_tokens": 50, "output_tokens": 10,
                              "cache_read_input_tokens": 5}}),
    ]
    events, usage = a.parse_stream(lines)
    msgs = [e for e in events if e["type"] == "agent.message"]
    assert msgs and "gen 输出" in msgs[0]["payload"]["text"]
    assert usage["input_tokens"] == 50
    assert usage["output_tokens"] == 10
    terminated = [e for e in events if e["type"] == "agent.terminated"]
    assert terminated and terminated[0]["payload"]["session_id"] == "s-1"
    assert terminated[0]["payload"]["stop_reason"] == "end_turn"


def test_generic_jsonl_session_extract():
    a = GenericAdapter(JSONL_CFG)
    assert a.extract_session_id({"type": "result", "session_id": "s-9"}) == "s-9"


def test_generic_text_parse():
    a = GenericAdapter(TEXT_CFG)
    lines = ["[tokens] prompt=100 completion=20 cached=30", "可见文本", "[done]"]
    events, usage = a.parse_stream(lines)
    msgs = [e for e in events if e["type"] == "agent.message"]
    assert msgs and "可见文本" in msgs[0]["payload"]["text"]
    # named-group 原样映射（不加和）；cached 计入 cache_read，是否并入 input 由用户正则决定
    assert usage["input_tokens"] == 100
    assert usage["output_tokens"] == 20
    assert usage["cache_read"] == 30


def test_generic_text_usage_regex_tolerates_non_numeric():
    """P3 回归：usage_regex 捕获含非数字（浮点成本/字母串）时跳过该字段，
    不抛异常中断整段 ingest（消息文本与数字字段仍保留）。"""
    cfg = {
        "cli_name": "floatcli",
        "bins": ["floatcli"],
        "parse": {
            "mode": "text",
            "usage_regex": r"\[usage\] input=(?P<input_tokens>\d+) "
                           r"cost=(?P<cost_usd>[\d.]+) bogus=(?P<cache_read>\w+)",
        },
    }
    a = GenericAdapter(cfg)
    lines = ["[usage] input=100 cost=0.003 bogus=abc", "正文"]
    events, usage = a.parse_stream(lines)
    assert usage["input_tokens"] == 100
    assert usage["cost_usd"] == 0.003  # float 捕获正常转
    assert usage["cache_read"] == 0     # 非数字捕获被跳过，不中断
    msgs = [e for e in events if e["type"] == "agent.message"]
    assert msgs and "正文" in msgs[0]["payload"]["text"]


def test_generic_missing_cli_name_rejected():
    with pytest.raises(ValueError):
        GenericAdapter({"bins": ["x"]})


def test_load_custom_adapters(tmp_path):
    """custom-clis/*.json 自动注册；坏配置仅告警不中断。"""
    custom = tmp_path / "custom-clis"
    custom.mkdir()
    (custom / "good.json").write_text(json.dumps(JSONL_CFG), encoding="utf-8")
    (custom / "bad.json").write_text("{not json", encoding="utf-8")
    loaded = load_custom_adapters(tmp_path)
    assert "mycli" in loaded
    assert get_adapter("mycli").cli_name == "mycli"
    with pytest.raises(ValueError):
        get_adapter("textcli")  # 未注册：仅 good.json 生效


def test_load_custom_adapters_no_dir(tmp_path):
    assert load_custom_adapters(tmp_path / "missing") == []


def test_adapter_names_contains_new_and_custom():
    names = adapter_names()
    for expect in ("codex", "kimi", "copilot", "pi", "zcode", "cline"):
        assert expect in names
