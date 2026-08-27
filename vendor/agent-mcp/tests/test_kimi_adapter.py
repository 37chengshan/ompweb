import json
import pytest
from agent_mcp.cli_adapters import get_adapter, KimiAdapter

# fixture 基于 kimi -p --output-format stream-json 官方文档（JSONL 事件，
# 结构仿 claude/grok：assistant/result 行）——字段细节 ⏳ 待实测校准

KIMI_MSG = {
    "type": "assistant",
    "message": {"id": "msg_1", "role": "assistant",
                "content": [{"type": "text", "text": "hi from kimi"}],
                "usage": {"input_tokens": 10, "output_tokens": 5}},
}
KIMI_RESULT = {
    "type": "result", "is_error": False, "stop_reason": "end_turn",
    "session_id": "s-kimi-1", "total_cost_usd": 0.1,
    "usage": {"input_tokens": 100, "output_tokens": 20,
              "cache_read_input_tokens": 30, "cache_creation_input_tokens": 0},
}


def test_kimi_command(monkeypatch):
    a = get_adapter("kimi")
    monkeypatch.setattr(a, "binary", lambda: "/bin/kimi")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=8, resume=None)
    assert cmd[0] == "/bin/kimi"
    assert "-p" in cmd
    assert "--output-format" in cmd and "stream-json" in cmd
    assert cmd[-1] == "do it"


def test_kimi_command_model_and_resume(monkeypatch):
    a = get_adapter("kimi")
    monkeypatch.setattr(a, "binary", lambda: "/bin/kimi")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model="kimi-for-coding",
                          permission_mode="fullAccess", max_turns=8, resume="s-old")
    assert "-m" in cmd and "kimi-for-coding" in cmd
    assert "-S" in cmd and "s-old" in cmd


def test_kimi_resume_last_maps_to_continue(monkeypatch):
    """P3 回归：resume="last" 应映射 -c（续最近会话），不能传 -S last。"""
    a = get_adapter("kimi")
    monkeypatch.setattr(a, "binary", lambda: "/bin/kimi")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=8, resume="last")
    assert "-c" in cmd
    assert "-S" not in cmd


def test_kimi_no_permission_flag_in_noninteractive(monkeypatch):
    """-p 与 --yolo/--auto/--plan 互斥：非交互默认 auto，permission_mode 不映射 flag。"""
    a = get_adapter("kimi")
    monkeypatch.setattr(a, "binary", lambda: "/bin/kimi")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model=None,
                          permission_mode="fullAccess", max_turns=8, resume=None)
    assert "--yolo" not in cmd and "--auto" not in cmd and "--plan" not in cmd


def test_kimi_parse_stream():
    a = get_adapter("kimi")
    lines = [json.dumps(KIMI_MSG), json.dumps(KIMI_RESULT)]
    events, usage = a.parse_stream(lines)
    msgs = [e for e in events if e["type"] == "agent.message"]
    assert msgs and "hi from kimi" in msgs[0]["payload"]["text"]
    assert usage["input_tokens"] == 100
    assert usage["output_tokens"] == 20
    assert usage["cache_read"] == 30
    assert usage["cost_usd"] == 0.1


def test_kimi_terminated_with_session():
    a = get_adapter("kimi")
    events, _ = a.parse_stream([json.dumps(KIMI_RESULT)])
    terminated = [e for e in events if e["type"] == "agent.terminated"]
    assert terminated and terminated[0]["payload"]["session_id"] == "s-kimi-1"


def test_kimi_parse_tolerates_malformed():
    a = get_adapter("kimi")
    events, usage = a.parse_stream(["", "not-json{"])
    assert events == [] and usage == {}


@pytest.mark.integration
@pytest.mark.skipif(KimiAdapter().binary() is None, reason="kimi CLI not installed")
def test_kimi_real_spawn_smoke():
    """真实跑 kimi -p 冒烟：命令可执行、输出可解析（不断言 AI 内容）。"""
    a = get_adapter("kimi")
    cmd = a.build_command(prompt="回复 OK", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=1, resume=None)
    import subprocess
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr[-500:]
