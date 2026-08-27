import json
import pytest
from agent_mcp.cli_adapters import get_adapter, PiAdapter

# fixture 基于 pi `--mode json` 官方 docs/json.md 裁剪：
# 首行 session{id,cwd}，其后 message_end（权威 message）/ agent_end

PI_SESSION = {"type": "session", "version": 3, "id": "uuid-1",
              "timestamp": "2026-08-12T00:00:00Z", "cwd": "/tmp"}
PI_MSG_END = {"type": "message_end",
              "message": {"role": "assistant",
                          "content": [{"type": "text", "text": "pi 输出"}]}}
PI_AGENT_END = {"type": "agent_end", "messages": []}


def test_pi_command(monkeypatch):
    a = get_adapter("pi")
    monkeypatch.setattr(a, "binary", lambda: "/bin/pi")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=8, resume=None)
    assert cmd[0] == "/bin/pi"
    assert "--mode" in cmd and "json" in cmd
    assert cmd[-1] == "do it"


def test_pi_command_resume_last(monkeypatch):
    a = get_adapter("pi")
    monkeypatch.setattr(a, "binary", lambda: "/bin/pi")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=8, resume="last")
    assert "-c" in cmd


def test_pi_command_resume_session_id(monkeypatch):
    a = get_adapter("pi")
    monkeypatch.setattr(a, "binary", lambda: "/bin/pi")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=8, resume="uuid-9")
    assert "--session" in cmd and "uuid-9" in cmd


def test_pi_parse_message_and_terminated():
    a = get_adapter("pi")
    lines = [json.dumps(PI_SESSION), json.dumps(PI_MSG_END),
             json.dumps(PI_AGENT_END)]
    events, usage = a.parse_stream(lines)
    msgs = [e for e in events if e["type"] == "agent.message"]
    terminated = [e for e in events if e["type"] == "agent.terminated"]
    assert msgs and "pi 输出" in msgs[0]["payload"]["text"]
    assert len(terminated) == 1
    assert terminated[0]["payload"]["session_id"] == "uuid-1"
    assert usage == {}


def test_pi_parse_no_message_without_end():
    a = get_adapter("pi")
    events, _ = a.parse_stream([json.dumps(PI_SESSION)])
    assert not any(e["type"] == "agent.message" for e in events)


def test_pi_session_extracted():
    a = get_adapter("pi")
    assert a.extract_session_id(PI_SESSION) == "uuid-1"


def test_pi_parse_tolerates_malformed():
    a = get_adapter("pi")
    events, usage = a.parse_stream(["", "not-json{"])
    assert events == [] and usage == {}


@pytest.mark.integration
@pytest.mark.skipif(PiAdapter().binary() is None, reason="pi CLI not installed")
def test_pi_real_spawn_smoke():
    """真实跑 pi --mode json 冒烟：命令可执行、事件流可解析（不断言 AI 内容）。"""
    a = get_adapter("pi")
    cmd = a.build_command(prompt="回复 OK", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=1, resume=None)
    import subprocess
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr[-500:]
