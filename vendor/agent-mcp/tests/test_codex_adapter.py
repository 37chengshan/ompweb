import json
import pytest
from agent_mcp.cli_adapters import get_adapter, CodexAdapter

# fixture 基于 codex exec --json 官方文档/PR 记录的事件结构裁剪
# （v0.44+：thread.started{item_type 已迁移到 item.type，解析兼容两种写法）

CODEX_THREAD = {"type": "thread.started", "thread_id": "thr_1"}
CODEX_TURN_START = {"type": "turn.started"}
CODEX_MSG = {"type": "item.completed",
             "item": {"id": "item_3", "item_type": "assistant_message",
                      "text": "Repo contains docs, sdk, and examples."}}
CODEX_MSG_NEW = {"type": "item.completed",
                 "item": {"id": "item_4", "type": "agent_message",
                          "text": "new field naming"}}
CODEX_CMD = {"type": "item.completed",
             "item": {"id": "item_1", "item_type": "command_execution",
                      "command": "bash -lc ls", "status": "completed",
                      "output": "docs\nsdk"}}
CODEX_TURN_DONE = {"type": "turn.completed",
                   "usage": {"input_tokens": 24763, "cached_input_tokens": 24448,
                             "output_tokens": 122, "reasoning_output_tokens": 0}}


def test_codex_command_basic():
    a = get_adapter("codex")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=8, resume=None)
    assert cmd[0].endswith("codex")
    assert "exec" in cmd and "--json" in cmd
    assert cmd[-1] == "do it"


def test_codex_command_model_and_full_access():
    a = get_adapter("codex")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model="gpt-5.6-sol",
                          permission_mode="fullAccess", max_turns=8, resume=None)
    assert "--model" in cmd and "gpt-5.6-sol" in cmd
    assert "--dangerously-bypass-approvals-and-sandbox" in cmd


def test_codex_command_accept_edits_sandbox():
    a = get_adapter("codex")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model=None,
                          permission_mode="acceptEdits", max_turns=8, resume=None)
    assert "--sandbox" in cmd and "workspace-write" in cmd


def test_codex_command_resume_last(monkeypatch):
    """P2 回归：resume 分支必须保留 --json（parse_stream 依赖 JSONL）
    且追加新指令 prompt（followup/steer/verify-fix 的续接指令不能丢）。"""
    a = get_adapter("codex")
    monkeypatch.setattr(a, "binary", lambda: "/bin/codex")
    cmd = a.build_command(prompt="继续任务", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=8, resume="last")
    assert cmd[0] == "/bin/codex"
    assert "resume" in cmd and "--last" in cmd
    assert "--json" in cmd
    assert cmd[-1] == "继续任务"


def test_codex_command_resume_id_keeps_json_and_prompt(monkeypatch):
    a = get_adapter("codex")
    monkeypatch.setattr(a, "binary", lambda: "/bin/codex")
    cmd = a.build_command(prompt="继续", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=8, resume="thr_9")
    assert "resume" in cmd and "thr_9" in cmd
    assert "--json" in cmd
    assert cmd[-1] == "继续"


def test_codex_parse_events_and_usage():
    a = get_adapter("codex")
    lines = [json.dumps(CODEX_THREAD), json.dumps(CODEX_TURN_START),
             json.dumps(CODEX_CMD), json.dumps(CODEX_MSG), json.dumps(CODEX_TURN_DONE)]
    events, usage = a.parse_stream(lines)
    msgs = [e for e in events if e["type"] == "agent.message"]
    tools = [e for e in events if e["type"] == "agent.tool_use"]
    assert msgs and "Repo contains" in msgs[0]["payload"]["text"]
    assert tools and tools[0]["payload"]["name"] == "bash"
    assert usage["input_tokens"] == 24763
    assert usage["output_tokens"] == 122
    assert usage["cache_read"] == 24448
    assert usage["reasoning_tokens"] == 0


def test_codex_parse_new_field_naming():
    """兼容版本漂移：item.type / agent_message 写法。"""
    a = get_adapter("codex")
    lines = [json.dumps(CODEX_THREAD), json.dumps(CODEX_MSG_NEW),
             json.dumps(CODEX_TURN_DONE)]
    events, _ = a.parse_stream(lines)
    msgs = [e for e in events if e["type"] == "agent.message"]
    assert msgs and "new field naming" in msgs[0]["payload"]["text"]


def test_codex_terminated_carries_thread_id():
    a = get_adapter("codex")
    lines = [json.dumps(CODEX_THREAD), json.dumps(CODEX_TURN_DONE)]
    events, _ = a.parse_stream(lines)
    terminated = [e for e in events if e["type"] == "agent.terminated"]
    assert len(terminated) == 1
    assert terminated[0]["payload"]["session_id"] == "thr_1"


def test_codex_turn_failed_terminated():
    a = get_adapter("codex")
    lines = [json.dumps(CODEX_THREAD),
             json.dumps({"type": "turn.failed", "error": {"message": "boom"}})]
    events, _ = a.parse_stream(lines)
    terminated = [e for e in events if e["type"] == "agent.terminated"]
    assert terminated and terminated[0]["payload"]["stop_reason"] == "error"


def test_codex_parse_tolerates_malformed():
    a = get_adapter("codex")
    events, usage = a.parse_stream(["", "not-json{", "null"])
    assert events == [] and usage == {}


def test_codex_session_extracted():
    a = get_adapter("codex")
    assert a.extract_session_id(CODEX_THREAD) == "thr_1"


@pytest.mark.integration
@pytest.mark.skipif(CodexAdapter().binary() is None, reason="codex CLI not installed")
def test_codex_real_spawn_smoke():
    """真实跑 codex exec --json 冒烟：命令可执行、事件流可解析（不断言 AI 内容）。"""
    a = get_adapter("codex")
    cmd = a.build_command(prompt="回复 OK", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=1, resume=None)
    import subprocess
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr[-500:]
    events, _ = a.parse_stream(proc.stdout.splitlines())
    assert any(e["type"] == "agent.message" for e in events)
