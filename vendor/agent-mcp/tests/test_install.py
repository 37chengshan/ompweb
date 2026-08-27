"""Isolated contracts for Agent MCP host installation and rollback."""
import json
import shlex
from pathlib import Path

import pytest

import install
from install import (
    BACKUP_SUFFIX,
    GITHUB_REPO,
    HOOK_MARKER,
    LEGACY_TOOL_MAP,
    _skill_backup_path,
    add_claude_session_start_hook,
    add_codex_session_start_hook,
    apply_claude_install,
    apply_codex_install,
    apply_kimi_install,
    apply_opencode_install,
    apply_zcode_install,
    backup_path,
    claude_registration_json,
    claude_session_start_entry,
    codex_registration_toml,
    codex_session_start_entry,
    find_legacy_section,
    has_section,
    install_host,
    install_skill,
    kimi_registration_json,
    legacy_tool_map_text,
    main,
    omp_registration_json,
    opencode_registration_json,
    posix_session_start_command,
    prompt_star,
    remove_legacy_section,
    rollback,
    skill_backup_root,
    windows_session_start_command,
    zcode_registration_json,
)

SCRIPT = "/tmp/mcp_server.py"
STARTER = "/tmp/agent mcp/start_agent_mcp.py"


def _skill_source(tmp_path):
    source = tmp_path / "source-skill"
    (source / "agents").mkdir(parents=True)
    (source / "SKILL.md").write_text("agent-mcp")
    (source / "agents" / "planner.md").write_text("planner")
    return source


def _paths(tmp_path):
    return {
        "codex_mcp": tmp_path / "codex" / "config.toml",
        "codex_hooks": tmp_path / "codex" / "hooks.json",
        "claude_mcp": tmp_path / "claude.json",
        "claude_hooks": tmp_path / "claude" / "settings.json",
        "codex_skill": tmp_path / "agents" / "skills" / "agent-mcp",
        "claude_skill": tmp_path / "claude" / "skills" / "agent-mcp",
        "omp_skill": tmp_path / "omp" / "skills" / "agent-mcp",
        "omp_mcp": tmp_path / "omp" / "mcp.json",
        "opencode_mcp": tmp_path / "opencode" / "opencode.json",
        "opencode_skill": tmp_path / "opencode" / "skills" / "agent-mcp",
        "kimi_mcp": tmp_path / "kimi" / "mcp.json",
        "kimi_skill": tmp_path / "kimi" / "skills" / "agent-mcp",
        "zcode_mcp": tmp_path / "zcode" / "config.json",
        "zcode_skill": tmp_path / "agents" / "skills" / "agent-mcp",
        "grok_mcp": tmp_path / "grok" / "config.toml",
        "cursor_mcp": tmp_path / "cursor" / "mcp.json",
        "gemini_mcp": tmp_path / "gemini" / "settings.json",
        "pi_mcp": tmp_path / "pi" / "mcp.json",
        "copilot_mcp": tmp_path / "copilot" / "mcp-config.json",
        "cline_mcp": tmp_path / "cline" / "mcp.json",
        "qwen_mcp": tmp_path / "qwen" / "settings.json",
        "devin_mcp": tmp_path / "devin" / "mcp_config.json",
        "windsurf_mcp": tmp_path / "windsurf" / "mcp_config.json",
        "amazonq_mcp": tmp_path / "amazonq" / "mcp.json",
        "atomcode_mcp": tmp_path / "kilo" / "kilo.json",
        "kiro_mcp": tmp_path / "kiro" / "mcp.json",
        "goose_mcp": tmp_path / "goose" / "config.yaml",
        "hermes_mcp": tmp_path / "hermes" / "config.yaml",
        "crush_mcp": tmp_path / "crush" / "crushrc",
    }


def _owned(entries):
    return [entry for entry in entries if HOOK_MARKER in json.dumps(entry)]


def test_registration_snippets():
    toml = codex_registration_toml(SCRIPT)
    assert "[mcp_servers.agent-mcp]" in toml
    assert 'command = "python3"' in toml
    assert "startup_timeout_sec = 30" in toml
    entry = claude_registration_json(SCRIPT)["mcpServers"]["agent-mcp"]
    assert entry["command"].endswith("python3")
    assert entry["args"] == [SCRIPT]
    omp_entry = omp_registration_json(SCRIPT)["mcpServers"]["agent-mcp"]
    assert omp_entry == {"type": "stdio", "command": "python3", "args": [SCRIPT],
                         "timeout": 30000, "requestIdFormat": "number", "enabled": True}
    opencode_entry = opencode_registration_json(SCRIPT)["mcp"]["agent-mcp"]
    assert opencode_entry == {"type": "local", "command": ["python3", SCRIPT], "enabled": True}
    kimi_entry = kimi_registration_json(SCRIPT)["mcpServers"]["agent-mcp"]
    assert kimi_entry == {"command": "python3", "args": [SCRIPT]}
    zcode_entry = zcode_registration_json(SCRIPT)["mcp"]["servers"]["agent-mcp"]
    assert zcode_entry == {"command": "python3", "args": [SCRIPT], "env": {}}


def test_backup_and_toml_helpers():
    path = backup_path(Path("/tmp/config.toml"), ts="20260803T010203")
    assert path.name == "config.toml.bak-agentmcp-20260803T010203"
    text = "[model_provider]\nname='x'\n\n[mcp_servers.agent-mcp]\ncommand='python3'\n"
    assert has_section(text, "mcp_servers.agent-mcp")
    assert not has_section(text, "mcp_servers.grok-cli")
    appended, action = apply_codex_install("x = 1", codex_registration_toml(SCRIPT))
    assert action == "append"
    assert appended.startswith("x = 1\n")
    unchanged, action = apply_codex_install(text, codex_registration_toml(SCRIPT))
    assert action == "skip" and unchanged == text

def test_backup_path_avoids_same_second_collisions(tmp_path):
    target = tmp_path / "config.json"
    first = backup_path(target, ts="20260803T010203")
    first.write_text("first")
    second = backup_path(target, ts="20260803T010203")
    assert second != first
    assert second.name.startswith("config.json.bak-agentmcp-20260803T010203")


def test_legacy_detection_removal_and_map():
    text = "# head\n[mcp_servers.grok-cli]\ncommand='x'\n\n[other]\nx=1\n"
    assert find_legacy_section(text)
    cleaned = remove_legacy_section(text)
    assert "grok-cli" not in cleaned and "[other]" in cleaned
    rendered = legacy_tool_map_text()
    assert len(LEGACY_TOOL_MAP) == 9
    for entry in LEGACY_TOOL_MAP:
        assert entry["old"] in rendered and entry["new"] in rendered


def test_apply_opencode_install_is_pure_and_preserves_other_servers():
    # opencode 顶层 mcp 结构
    config = {"mcp": {"other": {"type": "local", "command": ["x"]}}}
    out = apply_opencode_install(config, SCRIPT)
    assert out["mcp"]["other"] == {"type": "local", "command": ["x"]}
    assert out["mcp"]["agent-mcp"] == opencode_registration_json(SCRIPT)["mcp"]["agent-mcp"]
    assert config == {"mcp": {"other": {"type": "local", "command": ["x"]}}}  # 纯函数
    # opencode mcp.servers 结构（新版）
    config_v2 = {"mcp": {"servers": {"keep": {"type": "remote", "url": "u"}}}}
    out_v2 = apply_opencode_install(config_v2, SCRIPT)
    assert out_v2["mcp"]["servers"]["keep"] == {"type": "remote", "url": "u"}
    assert out_v2["mcp"]["servers"]["agent-mcp"] == opencode_registration_json(SCRIPT)["mcp"]["agent-mcp"]
    # 空配置
    assert apply_opencode_install({}, SCRIPT)["mcp"]["agent-mcp"]["command"] == ["python3", SCRIPT]


def test_apply_kimi_and_zcode_install_preserve_other_servers():
    kimi_out = apply_kimi_install({"mcpServers": {"keep": {"command": "x"}}}, SCRIPT)
    assert kimi_out["mcpServers"]["keep"] == {"command": "x"}
    assert kimi_out["mcpServers"]["agent-mcp"] == kimi_registration_json(SCRIPT)["mcpServers"]["agent-mcp"]
    zcode_out = apply_zcode_install({"mcp": {"servers": {"keep": {"command": "x"}}}}, SCRIPT)
    assert zcode_out["mcp"]["servers"]["keep"] == {"command": "x"}
    assert zcode_out["mcp"]["servers"]["agent-mcp"] == zcode_registration_json(SCRIPT)["mcp"]["servers"]["agent-mcp"]
    # zcode 空配置自动建 mcp.servers
    assert apply_zcode_install({}, SCRIPT)["mcp"]["servers"]["agent-mcp"]["args"] == [SCRIPT]


def test_apply_claude_install_is_pure_and_preserves_other_servers():
    config = {"permissions": {"allow": ["Bash"]}, "mcpServers": {"other": {"command": "x"}}}
    original = json.loads(json.dumps(config))
    updated = apply_claude_install(config, SCRIPT)
    assert config == original
    assert updated["permissions"] == config["permissions"]
    assert updated["mcpServers"]["other"] == {"command": "x"}
    assert updated["mcpServers"]["agent-mcp"]["args"] == [SCRIPT]


def test_session_commands_quote_paths_and_keep_owned_marker():
    posix = posix_session_start_command(STARTER, python_executable="/tmp/Python 3")
    # echo 提醒在前台输出（SessionStart stdout 注入上下文），网页启动放后台丢弃输出
    assert posix.startswith(f"echo {shlex.quote(install.MAIN_AGENT_REMINDER)}; ")
    assert "nohup '/tmp/Python 3' '/tmp/agent mcp/start_agent_mcp.py' --open" in posix
    assert posix.endswith(">/dev/null 2>&1 & # agent-mcp-session-start")
    windows = windows_session_start_command(STARTER, python_executable=r"C:\Python 3\python.exe")
    assert windows.startswith(f'echo "{install.MAIN_AGENT_REMINDER}" & ')
    assert 'start "" /B ' in windows
    assert '"C:\\Python 3\\python.exe"' in windows
    assert '"/tmp/agent mcp/start_agent_mcp.py"' in windows
    assert windows.endswith(">NUL 2>&1 & REM agent-mcp-session-start")


def test_host_specific_session_entries():
    claude = claude_session_start_entry(STARTER, platform="posix", python_executable="python")
    claude_action = claude["hooks"][0]
    assert claude["matcher"] == "startup|resume"
    assert claude_action["timeout"] == 10
    assert "command_windows" not in claude_action
    codex = codex_session_start_entry(STARTER, python_executable="python")
    codex_action = codex["hooks"][0]
    assert codex_action["timeout"] == 10
    assert HOOK_MARKER in codex_action["command"]
    assert "REM agent-mcp-session-start" in codex_action["command_windows"]


@pytest.mark.parametrize("transform", [add_claude_session_start_hook, add_codex_session_start_hook])
def test_hook_transform_is_pure_ordered_idempotent_and_deduplicating(transform):
    unrelated_a = {"matcher": "startup", "hooks": [{"type": "command", "command": "first"}]}
    unrelated_b = {"matcher": "resume", "hooks": [{"type": "command", "command": "last"}]}
    old_owned = {"matcher": "old", "hooks": [{"type": "command", "command": f"old {HOOK_MARKER}"}]}
    duplicate = {"matcher": "dup", "hooks": [{"type": "command", "command": f"dup {HOOK_MARKER}"}]}
    config = {"hooks": {"SessionStart": [unrelated_a, old_owned, unrelated_b, duplicate]}, "keep": 1}
    original = json.loads(json.dumps(config))
    updated = transform(config, STARTER)
    entries = updated["hooks"]["SessionStart"]
    assert config == original
    assert updated["keep"] == 1
    assert entries[0] == unrelated_a and entries[2] == unrelated_b
    assert len(_owned(entries)) == 1
    assert "start_agent_mcp.py" in json.dumps(entries[1])
    assert transform(updated, STARTER) == updated
    moved = transform(updated, "/new/repo/start_agent_mcp.py")
    assert len(_owned(moved["hooks"]["SessionStart"])) == 1
    assert "/new/repo" in json.dumps(_owned(moved["hooks"]["SessionStart"])[0])
    assert moved["hooks"]["SessionStart"][0] == unrelated_a
    assert moved["hooks"]["SessionStart"][2] == unrelated_b

def test_windows_claude_owned_hook_is_replaced_not_duplicated(monkeypatch):
    monkeypatch.setattr(install.os, "name", "nt")
    once = add_claude_session_start_hook({"hooks": {}}, STARTER)
    twice = add_claude_session_start_hook(once, "/new/repo/start_agent_mcp.py")
    entries = twice["hooks"]["SessionStart"]
    assert len(entries) == 1
    assert "/new/repo" in json.dumps(entries[0])


def test_install_skill_replaces_atomically_and_is_idempotent(tmp_path):
    source = _skill_source(tmp_path)
    destination = tmp_path / "skills" / "agent-mcp"
    sibling = destination.parent / "other-skill"
    sibling.mkdir(parents=True)
    (sibling / "SKILL.md").write_text("keep")
    destination.mkdir()
    (destination / "SKILL.md").write_text("old")
    (destination / "stale.txt").write_text("remove")

    logs = install_skill(source, destination)
    assert (destination / "SKILL.md").read_text() == "agent-mcp"
    assert (destination / "agents" / "planner.md").read_text() == "planner"
    assert not (destination / "stale.txt").exists()
    assert (sibling / "SKILL.md").read_text() == "keep"
    # 备份移出扫描目录：skills/ 内不再残留，备份落在 skill-backups/ 根
    backups = list(skill_backup_root(destination).glob(
        destination.name + BACKUP_SUFFIX + "*"))
    assert len(backups) == 1 and (backups[0] / "SKILL.md").read_text() == "old"
    assert not list(destination.parent.glob(destination.name + BACKUP_SUFFIX + "*"))
    assert any("备份" in line for line in logs)

    second = install_skill(source, destination)
    assert any("跳过" in line for line in second)
    assert len(list(skill_backup_root(destination).glob(
        destination.name + BACKUP_SUFFIX + "*"))) == 1


def test_install_skill_dry_run_is_non_mutating(tmp_path):
    source = _skill_source(tmp_path)
    destination = tmp_path / "skills" / "agent-mcp"
    logs = install_skill(source, destination, dry_run=True)
    assert any("dry-run" in line for line in logs)
    assert not destination.parent.exists()


@pytest.mark.parametrize(
    ("host", "mcp_key", "hook_key", "skill_key"),
    [
        ("codex", "codex_mcp", "codex_hooks", "codex_skill"),
        ("claude", "claude_mcp", "claude_hooks", "claude_skill"),
    ],
)
def test_complete_host_install_and_second_run_noop(tmp_path, host, mcp_key, hook_key, skill_key):
    paths = _paths(tmp_path)
    paths[mcp_key].parent.mkdir(parents=True, exist_ok=True)
    paths[mcp_key].write_text("# existing\n" if host == "codex" else json.dumps({"mcpServers": {"other": {"command": "x"}}}))
    paths[hook_key].parent.mkdir(parents=True, exist_ok=True)
    paths[hook_key].write_text(json.dumps({"hooks": {"SessionStart": [{"matcher": "keep", "hooks": []}]}}))
    paths[skill_key].mkdir(parents=True)
    (paths[skill_key] / "SKILL.md").write_text("old")
    source = _skill_source(tmp_path)

    logs = install_host(host, SCRIPT, STARTER, source, paths)
    hook_config = json.loads(paths[hook_key].read_text())
    assert hook_config["hooks"]["SessionStart"][0]["matcher"] == "keep"
    assert len(_owned(hook_config["hooks"]["SessionStart"])) == 1
    assert (paths[skill_key] / "agents" / "planner.md").read_text() == "planner"
    for target in (paths[mcp_key], paths[hook_key]):
        assert list(target.parent.glob(target.name + BACKUP_SUFFIX + "*"))
    skill_target = paths[skill_key]
    assert list(skill_backup_root(skill_target).glob(
        skill_target.name + BACKUP_SUFFIX + "*"))
    backup_count = len(list(tmp_path.rglob("*" + BACKUP_SUFFIX + "*")))
    assert any("已写入" in line or "已安装" in line for line in logs)

    second = install_host(host, SCRIPT, STARTER, source, paths)
    assert all("已写入" not in line and "已安装" not in line for line in second)
    assert len(list(tmp_path.rglob("*" + BACKUP_SUFFIX + "*"))) == backup_count


def test_omp_installs_mcp_config_and_skill_without_hook(tmp_path):
    paths = _paths(tmp_path)
    paths["omp_mcp"].parent.mkdir(parents=True)
    paths["omp_mcp"].write_text(json.dumps({"mcpServers": {"other": {"command": "x"}}}))
    logs = install_host("omp", SCRIPT, STARTER, _skill_source(tmp_path), paths)
    config = json.loads(paths["omp_mcp"].read_text())
    assert config["mcpServers"]["other"] == {"command": "x"}
    assert config["mcpServers"]["agent-mcp"] == omp_registration_json(SCRIPT)["mcpServers"]["agent-mcp"]
    assert (paths["omp_skill"] / "SKILL.md").read_text() == "agent-mcp"
    assert any("SessionStart" in line and "不支持" in line for line in logs)


@pytest.mark.parametrize(
    ("host", "mcp_key", "apply_fn", "reg_fn", "skill_key"),
    [
        ("opencode", "opencode_mcp", apply_opencode_install, opencode_registration_json, "opencode_skill"),
        ("kimi", "kimi_mcp", apply_kimi_install, kimi_registration_json, "kimi_skill"),
        ("zcode", "zcode_mcp", apply_zcode_install, zcode_registration_json, "zcode_skill"),
    ],
)
def test_json_host_installs_config_and_skill_without_hook(
    tmp_path, host, mcp_key, apply_fn, reg_fn, skill_key
):
    paths = _paths(tmp_path)
    paths[mcp_key].parent.mkdir(parents=True)
    paths[mcp_key].write_text(json.dumps({"keep": {"command": "x"}}))
    logs = install_host(host, SCRIPT, STARTER, _skill_source(tmp_path), paths)
    config = json.loads(paths[mcp_key].read_text())
    if host == "opencode":
        entry = reg_fn(SCRIPT)["mcp"]["agent-mcp"]
    elif host == "zcode":
        entry = reg_fn(SCRIPT)["mcp"]["servers"]["agent-mcp"]
    else:
        entry = reg_fn(SCRIPT)["mcpServers"]["agent-mcp"]
    assert config["keep"] == {"command": "x"}
    # 通过 apply_fn 反推 agent-mcp 注册位置
    merged = apply_fn({"keep": {"command": "x"}}, SCRIPT)
    if host == "zcode":
        assert config["mcp"]["servers"]["agent-mcp"] == entry
        assert config["mcp"]["servers"] == merged["mcp"]["servers"]
    elif host == "opencode":
        assert config["mcp"]["agent-mcp"] == entry
        assert config["mcp"] == merged["mcp"]
    else:
        assert config["mcpServers"]["agent-mcp"] == entry
        assert config["mcpServers"] == merged["mcpServers"]
    assert (paths[skill_key] / "SKILL.md").read_text() == "agent-mcp"
    assert any("SessionStart" in line and "不支持" in line for line in logs)


def test_prompt_star_stars_via_gh_when_logged_in(monkeypatch, capsys):
    calls = []
    def fake_run(cmd, *args, **kwargs):
        calls.append(cmd)
        class Proc:
            returncode = 0
        return Proc()
    monkeypatch.setattr(install.subprocess, "run", fake_run)
    prompt_star()
    out = capsys.readouterr().out
    assert calls[0] == ["gh", "auth", "status"]
    assert calls[1] == ["gh", "repo", "star", GITHUB_REPO]
    assert "点亮 star" in out


def test_prompt_star_falls_back_to_browser_when_no_gh(monkeypatch, capsys):
    def fake_run(cmd, *args, **kwargs):
        raise FileNotFoundError("gh not found")
    monkeypatch.setattr(install.subprocess, "run", fake_run)
    opened = []
    monkeypatch.setattr(install, "_open_url", lambda url: opened.append(url))
    prompt_star()
    out = capsys.readouterr().out
    assert opened == [install.GITHUB_STAR_URL]
    assert "点个 star" in out


def test_prompt_star_falls_back_when_gh_not_logged_in(monkeypatch, capsys):
    def fake_run(cmd, *args, **kwargs):
        class Proc:
            returncode = 1 if cmd == ["gh", "auth", "status"] else 0
        return Proc()
    monkeypatch.setattr(install.subprocess, "run", fake_run)
    opened = []
    monkeypatch.setattr(install, "_open_url", lambda url: opened.append(url))
    prompt_star()
    assert opened == [install.GITHUB_STAR_URL]


def test_install_unknown_host_raises(tmp_path):
    with pytest.raises(ValueError):
        install_host("windows", SCRIPT, STARTER, _skill_source(tmp_path), _paths(tmp_path))


def test_dry_run_all_hosts_changes_nothing(tmp_path, monkeypatch, capsys):
    paths = _paths(tmp_path)
    paths["codex_mcp"].parent.mkdir(parents=True)
    paths["codex_mcp"].write_text("# codex\n")
    paths["codex_hooks"].write_text("{\"hooks\": {}}")
    paths["claude_mcp"].write_text("{\"mcpServers\": {}}")
    paths["claude_hooks"].parent.mkdir(parents=True)
    paths["claude_hooks"].write_text("{\"hooks\": {}}")
    before = {key: path.read_bytes() for key, path in paths.items() if path.is_file()}
    script = tmp_path / "mcp_server.py"
    script.write_text("x")
    starter = tmp_path / "start_agent_mcp.py"
    starter.write_text("x")
    skill = _skill_source(tmp_path)
    monkeypatch.setattr(install, "default_paths", lambda: paths)
    monkeypatch.setattr(install, "default_starter_path", lambda: starter)
    monkeypatch.setattr(install, "default_skill_path", lambda: skill)

    assert main(["--install", "--host", "all", "--dry-run", str(script)]) == 0
    output = capsys.readouterr().out
    assert "codex" in output and "claude" in output and "omp" in output
    # v0.3 扩展 host 全部出现在 dry-run 输出（全覆盖）
    assert "atomcode" in output and "goose" in output and "hermes" in output
    assert "crush" in output and "cursor" in output
    for key, content in before.items():
        assert paths[key].read_bytes() == content
    assert not list(tmp_path.rglob("*" + BACKUP_SUFFIX + "*"))
    assert not paths["codex_skill"].exists()
    assert not paths["claude_skill"].exists()
    assert not paths["omp_skill"].exists()


def test_main_all_installs_every_supported_surface(tmp_path, monkeypatch):
    paths = _paths(tmp_path)
    script = tmp_path / "mcp_server.py"
    script.write_text("x")
    starter = tmp_path / "start_agent_mcp.py"
    starter.write_text("x")
    skill = _skill_source(tmp_path)
    monkeypatch.setattr(install, "default_paths", lambda: paths)
    monkeypatch.setattr(install, "default_starter_path", lambda: starter)
    monkeypatch.setattr(install, "default_skill_path", lambda: skill)

    assert main(["--install", "--host", "all", str(script)]) == 0
    assert "agent-mcp" in paths["codex_mcp"].read_text()
    assert "agent-mcp" in json.loads(paths["claude_mcp"].read_text())["mcpServers"]
    assert "agent-mcp" in json.loads(paths["omp_mcp"].read_text())["mcpServers"]
    assert len(_owned(json.loads(paths["codex_hooks"].read_text())["hooks"]["SessionStart"])) == 1
    assert len(_owned(json.loads(paths["claude_hooks"].read_text())["hooks"]["SessionStart"])) == 1
    for key in ("codex_skill", "claude_skill", "omp_skill"):
        assert (paths[key] / "SKILL.md").read_text() == "agent-mcp"


def test_corrupt_selected_hook_preflight_prevents_partial_install(tmp_path, monkeypatch):
    paths = _paths(tmp_path)
    paths["codex_mcp"].parent.mkdir(parents=True)
    paths["codex_mcp"].write_text("# unchanged\n")
    paths["codex_hooks"].write_text("{bad")
    paths["claude_mcp"].write_text("{\"mcpServers\": {}}")
    paths["claude_hooks"].parent.mkdir(parents=True)
    paths["claude_hooks"].write_text("{\"hooks\": {}}")
    script = tmp_path / "mcp_server.py"
    script.write_text("x")
    starter = tmp_path / "start_agent_mcp.py"
    starter.write_text("x")
    skill = _skill_source(tmp_path)
    monkeypatch.setattr(install, "default_paths", lambda: paths)
    monkeypatch.setattr(install, "default_starter_path", lambda: starter)
    monkeypatch.setattr(install, "default_skill_path", lambda: skill)

    assert main(["--install", "--host", "all", str(script)]) == 1
    assert paths["codex_mcp"].read_text() == "# unchanged\n"
    assert paths["claude_mcp"].read_text() == "{\"mcpServers\": {}}"
    assert not paths["codex_skill"].exists()
    assert not paths["claude_skill"].exists()
    assert not paths["omp_skill"].exists()
    assert not list(tmp_path.rglob("*" + BACKUP_SUFFIX + "*"))


def test_missing_bundled_source_preflight_prevents_writes(tmp_path, monkeypatch):
    paths = _paths(tmp_path)
    script = tmp_path / "mcp_server.py"
    script.write_text("x")
    monkeypatch.setattr(install, "default_paths", lambda: paths)
    monkeypatch.setattr(install, "default_starter_path", lambda: tmp_path / "missing-starter.py")
    monkeypatch.setattr(install, "default_skill_path", lambda: tmp_path / "missing-skill")
    assert main(["--install", "--host", "all", str(script)]) == 1
    assert not any(path.exists() for path in paths.values())


def test_rollback_restores_latest_mcp_hook_and_skill_backups(tmp_path):
    paths = _paths(tmp_path)
    for key in ("codex_mcp", "codex_hooks"):
        target = paths[key]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("new")
        backup = backup_path(target, ts="20260803T010203")
        backup.write_text("old")
    target = paths["codex_skill"]
    target.mkdir(parents=True)
    (target / "SKILL.md").write_text("new")
    # skill 备份落在 skill-backups/ 根（扫描目录之外）
    backup = _skill_backup_path(target, ts="20260803T010203")
    backup.mkdir()
    (backup / "SKILL.md").write_text("old")

    logs = rollback(paths, host="codex")
    assert paths["codex_mcp"].read_text() == "old"
    assert paths["codex_hooks"].read_text() == "old"
    assert (paths["codex_skill"] / "SKILL.md").read_text() == "old"
    assert not list(tmp_path.rglob("*" + BACKUP_SUFFIX + "*"))
    assert len([line for line in logs if "已从" in line]) == 3


def test_rollback_dry_run_is_parser_error():
    with pytest.raises(SystemExit) as exc:
        install.parse_args(["--rollback", "--dry-run"])
    assert exc.value.code == 2
