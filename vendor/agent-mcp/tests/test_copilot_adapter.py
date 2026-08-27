import pytest
from agent_mcp.cli_adapters import get_adapter, CopilotAdapter

# fixture 基于 github/copilot-cli `copilot -p` 输出裁剪：
# 文本输出 + 退出摘要含 `copilot --resume=SESSION-ID` 续接提示（⏳ 待实测精修）

COPILOT_OUT = [
    "正在分析仓库结构...",
    "发现 3 个相关文件。",
    "Run copilot --resume=a1b2c3 to continue this session",
    "任务完成。",
]


def test_copilot_command_basic():
    a = get_adapter("copilot")
    cmd = a.build_command(prompt="explain this repo", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=8, resume=None)
    assert cmd[0].endswith("copilot")
    assert "-p" in cmd
    assert cmd[-1] == "explain this repo"


def test_copilot_command_resume():
    a = get_adapter("copilot")
    cmd = a.build_command(prompt="", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=8, resume="a1b2c3")
    assert "--resume" in cmd and "a1b2c3" in cmd


def test_copilot_command_full_access_allow_all():
    a = get_adapter("copilot")
    cmd = a.build_command(prompt="do it", cwd="/tmp", model=None,
                          permission_mode="fullAccess", max_turns=8, resume=None)
    assert "--allow" in cmd and "all" in cmd


def test_copilot_parse_text_message():
    a = get_adapter("copilot")
    events, usage = a.parse_stream(COPILOT_OUT)
    msgs = [e for e in events if e["type"] == "agent.message"]
    assert msgs and "正在分析仓库结构" in msgs[0]["payload"]["text"]
    assert "任务完成" in msgs[0]["payload"]["text"]
    assert usage == {}


def test_copilot_parse_resume_hint_sets_session():
    """退出摘要的 --resume=<id> 回填 terminated.session_id（resume 链路）。"""
    a = get_adapter("copilot")
    events, _ = a.parse_stream(COPILOT_OUT)
    terminated = [e for e in events if e["type"] == "agent.terminated"]
    assert len(terminated) == 1
    assert terminated[0]["payload"]["session_id"] == "a1b2c3"


def test_copilot_parse_empty():
    a = get_adapter("copilot")
    events, usage = a.parse_stream(["", "   "])
    assert events == [] and usage == {}


@pytest.mark.integration
@pytest.mark.skip(reason="不跑真实 CLI（用户约束）：copilot -p 依赖真实网络/订阅，"
                         "断网/代理下会 CAPIError 连接错误导致 flaky")
def test_copilot_real_spawn_smoke():
    """真实跑 copilot -p 冒烟：命令可执行（不断言 AI 内容）。"""
    a = get_adapter("copilot")
    cmd = a.build_command(prompt="回复 OK", cwd="/tmp", model=None,
                          permission_mode="plan", max_turns=1, resume=None)
    import subprocess
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr[-500:]
