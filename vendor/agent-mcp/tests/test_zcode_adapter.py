import pytest
from agent_mcp.cli_adapters import get_adapter, ZcodeAdapter

# fixture 基于 zcode --prompt 保守文本捕获（headless 路径 ⏳ 待实测）

ZCODE_OUT = [
    "ZCode 输出行 1",
    "ZCode 输出行 2",
]


def test_zcode_command(monkeypatch):
    a = get_adapter("zcode")
    monkeypatch.setattr(a, "binary", lambda: "/bin/zcode")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=8, resume=None)
    assert cmd[0] == "/bin/zcode"
    assert "--prompt" in cmd
    assert cmd[-1] == "do it"


def test_zcode_command_model_and_resume(monkeypatch):
    a = get_adapter("zcode")
    monkeypatch.setattr(a, "binary", lambda: "/bin/zcode")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model="glm-5.2",
                          permission_mode="plan", max_turns=8, resume="s-1")
    assert "--model" in cmd and "glm-5.2" in cmd
    assert "--session" in cmd and "s-1" in cmd


def test_zcode_parse_text():
    a = get_adapter("zcode")
    events, usage = a.parse_stream(ZCODE_OUT)
    msgs = [e for e in events if e["type"] == "agent.message"]
    assert msgs and "ZCode 输出行 1" in msgs[0]["payload"]["text"]
    assert "ZCode 输出行 2" in msgs[0]["payload"]["text"]
    assert usage == {}


def test_zcode_parse_empty():
    a = get_adapter("zcode")
    events, usage = a.parse_stream(["", "   "])
    assert events == [] and usage == {}


@pytest.mark.integration
@pytest.mark.skipif(ZcodeAdapter().binary() is None, reason="zcode CLI not installed")
def test_zcode_real_spawn_smoke():
    """真实跑 zcode --prompt 冒烟：命令可执行（不断言 AI 内容）。"""
    a = get_adapter("zcode")
    cmd = a.build_command(prompt="回复 OK", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=1, resume=None)
    import subprocess
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr[-500:]
