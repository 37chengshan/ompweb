"""配套 skill 测试：SKILL.md 完整性 + 内置 agent 预设存在性与去模型化 + 等待纪律契约。"""
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

TOOLS = ("spawn_agent", "send_message", "steer_agent", "followup_task", "wait_agent",
         "interrupt_agent", "list_agents", "get_agent_activity", "get_token_usage")

AGENT_NAMES = ("planner", "architect", "code-reviewer", "security-reviewer",
               "tdd-guide", "build-error-resolver", "e2e-runner",
               "refactor-cleaner", "doc-updater", "code-explorer")


def test_skill_docs_exist_and_complete():
    skill = (PROJECT_ROOT / "skill" / "SKILL.md").read_text(encoding="utf-8")
    for tool in TOOLS:
        assert tool in skill
    assert "target_cli" in skill
    for cli in ("claude", "grok", "opencode", "omp", "atomcode"):
        assert cli in skill
    assert "deepseek-v4-flash" in skill  # AtomCode task-only one-shot 指引
    assert "description: Use when" in skill
    assert "agent.user_turn" in skill
    assert "URL fragment" in skill
    assert "[tokens]" in skill
    assert "session_id" in skill


def test_builtin_agents_exist():
    agents = {p.stem for p in (PROJECT_ROOT / "skill" / "agents").glob("*.md")}
    for name in AGENT_NAMES:
        assert name in agents


def test_builtin_agents_have_no_model_pinning():
    for p in (PROJECT_ROOT / "skill" / "agents").glob("*.md"):
        text = p.read_text(encoding="utf-8").lower()
        assert "model" not in text.split("---")[2]  # 正文无 model 指定


BRIEF_FIELDS = ("目标", "工作范围", "边界", "自审级别", "输出格式", "卡住升级")


def test_task_brief_template_exists_and_locks_six_elements():
    skill = (PROJECT_ROOT / "skill" / "SKILL.md").read_text(encoding="utf-8")
    brief = PROJECT_ROOT / "skill" / "task-brief.md"
    assert brief.exists(), "任务简报模板缺失"
    text = brief.read_text(encoding="utf-8")
    assert "task-brief.md" in skill  # SKILL.md 必须引用模板
    for field in BRIEF_FIELDS:
        assert field in skill, f"SKILL.md 缺六要素字段：{field}"
        assert field in text, f"task-brief.md 缺六要素字段：{field}"
    assert "FINAL_ANSWER" in text  # 输出契约锁死
    assert "未填字段不出现" in skill  # prompt 体积控制规则


def test_waiting_discipline_constraint_locked():
    skill = (PROJECT_ROOT / "skill" / "SKILL.md").read_text(encoding="utf-8")
    assert "静默等待" in skill  # 第四步标题：静默等待
    assert "唯一主规则" in skill  # 唯一主规则：循环 wait_agent 短轮询
    assert "循环调用" in skill  # 未完成就循环 wait_agent
    assert "timeout=25" in skill  # 单次 ≤ MCP 客户端 ~30s 截断上限
    assert "不要调用" in skill  # 不要调用 list_agents/get_agent_activity 轮询
    assert "轮询" in skill
    assert "wait_agent" in skill  # 等待依赖 wait_agent 阻塞
    assert "禁止用 echo/no-op 命令空转试探" in skill  # 工具 error 时停手，不空转
    assert "session 生命周期" in skill  # 会话重启 → 旧 agent 失联属预期的说明
    assert "不要复用旧 agent_id" in skill  # session 不匹配 → 重新 spawn 而非复用
    assert "存活证据" in skill  # wait hint 带 worker_pid/日志 mtime 存活证据
    assert "疑似僵住" in skill  # 僵住判定改硬信号
    assert "stderr" in skill  # AtomCode 进度在 stderr 的说明


def test_best_practice_optimizations_locked():
    skill = (PROJECT_ROOT / "skill" / "SKILL.md").read_text(encoding="utf-8")
    brief = (PROJECT_ROOT / "skill" / "task-brief.md").read_text(encoding="utf-8")
    # 唯一主规则：静默等待而非频繁轮询
    assert "唯一主规则" in skill
    # 成本纪律：默认低档位，无明确理由不升级
    assert "成本纪律" in skill
    # 输出契约：FINAL_ANSWER 摘要 ≤3 行，SKILL.md 与模板一致
    assert "≤3 行" in skill
    assert "≤3 行" in brief
    # 会话重开找回：宿主稳定会话标识 + include_other_sessions
    assert "CLAUDE_CODE_SESSION_ID" in skill
    assert "include_other_sessions" in skill
    # 主代理评判协议（三查）：不亲信、不过度
    assert "主代理评判协议" in skill
    assert "对目标" in skill and "查证据" in skill and "判返工" in skill
    assert "不亲信" in skill and "不过度" in skill
    # 子代理回传前自证达成
    assert "自证达成" in skill
    assert "自证达成" in brief
    assert "未达成不得报完成" in brief


def test_builtin_agents_have_output_and_escalation_contract():
    for p in (PROJECT_ROOT / "skill" / "agents").glob("*.md"):
        text = p.read_text(encoding="utf-8")
        assert "## 输出格式" in text, f"{p.name} 缺输出格式小节"
        assert "FINAL_ANSWER" in text, f"{p.name} 缺 FINAL_ANSWER 输出契约"
        assert "≤3 行" in text, f"{p.name} 缺摘要长度约束"
        assert "## 卡住升级" in text, f"{p.name} 缺卡住升级小节"
        assert "BLOCKED" in text and "NEEDS_CONTEXT" in text, f"{p.name} 缺 BLOCKED/NEEDS_CONTEXT 升级协议"


def test_wait_agent_defaults_to_short_block():
    server = (PROJECT_ROOT / "mcp_server.py").read_text(encoding="utf-8")
    assert "单次短阻塞" in server  # wait_agent 描述为单次短阻塞
    assert "循环调用本工具" in server  # 未完成循环 wait_agent
    assert '"default": 25' in server  # timeout 默认 25s（≤客户端 ~30s 截断上限）
    assert "不要调用" in server  # 描述禁止 list_agents/get_agent_activity 轮询


def test_wait_hint_does_not_suggest_polling():
    daemon = (PROJECT_ROOT / "agent_mcp" / "daemon_main.py").read_text(encoding="utf-8")
    assert "call wait_agent again" in daemon  # 超时 hint 引导继续 wait_agent
    assert "do not poll list_agents" in daemon  # 超时 hint 明确禁止轮询
