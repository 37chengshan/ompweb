"""v0.3 installer 扩展测试：A/B/C 模板注册 + YAML/rc 注册 + 新 host 安装。"""
import json

import pytest

import install
from install import (
    HOSTS,
    SERVER_NAME,
    _install_text_transform,
    apply_atomcode_install,
    apply_crush_install,
    apply_goose_install,
    apply_hermes_install,
    apply_mcp_servers_install,
    atomcode_registration_json,
    crush_registration_rc,
    goose_registration_yaml,
    hermes_registration_yaml,
    install_host,
    mcp_servers_entry,
    rollback,
)

SCRIPT = "/tmp/mcp_server.py"


# -- 模板注册函数 ---------------------------------------------------------

def test_a_template_entry_shape():
    entry = mcp_servers_entry(SCRIPT)
    assert entry == {"command": "python3", "args": [SCRIPT]}


def test_a_template_apply_preserves_other_servers():
    config = {"mcpServers": {"keep": {"command": "x"}}, "top": 1}
    out = apply_mcp_servers_install(config, SCRIPT)
    assert out["mcpServers"]["keep"] == {"command": "x"}
    assert out["mcpServers"][SERVER_NAME]["args"] == [SCRIPT]
    assert out["top"] == 1


def test_grok_reuses_codex_toml():
    assert install.grok_registration_toml(SCRIPT) == install.codex_registration_toml(SCRIPT)
    assert f"[mcp_servers.{SERVER_NAME}]" in install.grok_registration_toml(SCRIPT)


def test_atomcode_entry_matches_opencode_structure():
    entry = atomcode_registration_json(SCRIPT)["mcp"][SERVER_NAME]
    assert entry == {"type": "local", "command": ["python3", SCRIPT], "enabled": True}


def test_atomcode_apply_preserves_other_mcp():
    config = {"mcp": {"other": {"type": "local", "command": ["x"]}}}
    out = apply_atomcode_install(config, SCRIPT)
    assert out["mcp"]["other"]["command"] == ["x"]
    assert out["mcp"][SERVER_NAME]["command"] == ["python3", SCRIPT]


# -- YAML / rc 注册 -------------------------------------------------------

def test_goose_yaml_block_shape():
    block = goose_registration_yaml(SCRIPT)
    assert "extensions:" in block
    assert f"  {SERVER_NAME}:" in block
    assert "cmd: python3" in block
    assert f"args: {json.dumps([SCRIPT])}" in block
    assert "enabled: true" in block


def test_goose_apply_append_to_empty():
    new_text, action = apply_goose_install("", SCRIPT)
    assert action == "append"
    assert "extensions:" in new_text and f"  {SERVER_NAME}:" in new_text


def test_goose_apply_preserves_provider_section():
    existing = "provider:\n  name: databricks\n"
    new_text, action = apply_goose_install(existing, SCRIPT)
    assert action == "append"
    assert "provider:" in new_text
    assert new_text.index("provider:") < new_text.index("extensions:")


def test_goose_apply_idempotent():
    first, _ = apply_goose_install("", SCRIPT)
    second, action = apply_goose_install(first, SCRIPT)
    assert action == "skip"


def test_hermes_yaml_block_shape():
    block = hermes_registration_yaml(SCRIPT)
    assert "mcp_servers:" in block
    assert f"  {SERVER_NAME}:" in block
    assert "command: python3" in block
    assert f"args: {json.dumps([SCRIPT])}" in block


def test_hermes_apply_idempotent_and_preserves_other():
    first, _ = apply_hermes_install("", SCRIPT)
    second, action = apply_hermes_install(first, SCRIPT)
    assert action == "skip"
    # 已有 mcp_servers 其他 server → 追加不覆盖
    existing = "mcp_servers:\n  other:\n    command: x\n"
    new_text, action = apply_hermes_install(existing, SCRIPT)
    assert action == "append"
    assert "other:" in new_text and SERVER_NAME in new_text


def test_crush_rc_line_and_idempotency():
    line = crush_registration_rc("/tmp/my mcp.py")
    assert line.startswith(f"mcp add {SERVER_NAME} --type stdio --command python3")
    # 路径含空格 → shlex 引号
    assert "'/tmp/my mcp.py'" in line
    new_text, action = apply_crush_install("", "/tmp/my mcp.py")
    assert action == "append"
    second, action2 = apply_crush_install(new_text, "/tmp/my mcp.py")
    assert action2 == "skip"


def test_text_transform_installer(tmp_path):
    path = tmp_path / "config.yaml"
    logs = _install_text_transform(
        path, lambda text: apply_goose_install(text, SCRIPT),
        dry_run=False, description="goose extensions")
    assert any("已写入" in log for log in logs)
    assert path.exists() and "extensions:" in path.read_text()
    # 幂等
    logs2 = _install_text_transform(
        path, lambda text: apply_goose_install(text, SCRIPT),
        dry_run=False, description="goose extensions")
    assert any("已存在，跳过" in log for log in logs2)


# -- 新 host 安装（tmp_path 隔离） ----------------------------------------

def _paths(tmp_path):
    home = tmp_path
    return {
        "grok_mcp": home / ".grok" / "config.toml",
        "cursor_mcp": home / ".cursor" / "mcp.json",
        "gemini_mcp": home / ".gemini" / "settings.json",
        "pi_mcp": home / ".pi" / "agent" / "mcp.json",
        "copilot_mcp": home / ".copilot" / "mcp-config.json",
        "cline_mcp": home / ".cline" / "mcp.json",
        "qwen_mcp": home / ".qwen" / "settings.json",
        "devin_mcp": home / ".config" / "devin" / "mcp_config.json",
        "windsurf_mcp": home / ".codeium" / "windsurf" / "mcp_config.json",
        "amazonq_mcp": home / ".aws" / "amazonq" / "mcp.json",
        "atomcode_mcp": home / ".config" / "kilo" / "kilo.json",
        "kiro_mcp": home / ".kiro" / "settings" / "mcp.json",
        "goose_mcp": home / ".config" / "goose" / "config.yaml",
        "hermes_mcp": home / ".hermes" / "config.yaml",
        "crush_mcp": home / ".config" / "crush" / "crushrc",
    }


@pytest.mark.parametrize("host,key,assert_fn", [
    ("grok", "grok_mcp", lambda p: f"[mcp_servers.{SERVER_NAME}]" in p.read_text()),
    ("cursor", "cursor_mcp",
     lambda p: json.loads(p.read_text())["mcpServers"][SERVER_NAME]["args"] == [SCRIPT]),
    ("gemini", "gemini_mcp",
     lambda p: json.loads(p.read_text())["mcpServers"][SERVER_NAME]["command"] == "python3"),
    ("pi", "pi_mcp",
     lambda p: json.loads(p.read_text())["mcpServers"][SERVER_NAME]["args"] == [SCRIPT]),
    ("copilot", "copilot_mcp",
     lambda p: json.loads(p.read_text())["mcpServers"][SERVER_NAME]["args"] == [SCRIPT]),
    ("cline", "cline_mcp",
     lambda p: json.loads(p.read_text())["mcpServers"][SERVER_NAME]["args"] == [SCRIPT]),
    ("qwen", "qwen_mcp",
     lambda p: json.loads(p.read_text())["mcpServers"][SERVER_NAME]["args"] == [SCRIPT]),
    ("devin", "devin_mcp",
     lambda p: json.loads(p.read_text())["mcpServers"][SERVER_NAME]["args"] == [SCRIPT]),
    ("windsurf", "windsurf_mcp",
     lambda p: json.loads(p.read_text())["mcpServers"][SERVER_NAME]["args"] == [SCRIPT]),
    ("amazon-q", "amazonq_mcp",
     lambda p: json.loads(p.read_text())["mcpServers"][SERVER_NAME]["args"] == [SCRIPT]),
    ("kiro", "kiro_mcp",
     lambda p: json.loads(p.read_text())["mcpServers"][SERVER_NAME]["args"] == [SCRIPT]),
    ("atomcode", "atomcode_mcp",
     lambda p: json.loads(p.read_text())["mcp"]["agent-mcp"]["command"] == ["python3", SCRIPT]),
])
def test_new_json_hosts_install(tmp_path, host, key, assert_fn):
    paths = _paths(tmp_path)
    logs = install_host(host, SCRIPT, "/tmp/starter", tmp_path / "skill", paths)
    assert any("已写入" in log for log in logs)
    assert assert_fn(paths[key])
    # 幂等：第二次 skip
    logs2 = install_host(host, SCRIPT, "/tmp/starter", tmp_path / "skill", paths)
    assert any("已存在，跳过" in log or "内容相同，跳过" in log for log in logs2)


def test_goose_host_install(tmp_path):
    paths = _paths(tmp_path)
    logs = install_host("goose", SCRIPT, "/tmp/starter", tmp_path / "skill", paths)
    assert any("已写入" in log for log in logs)
    text = paths["goose_mcp"].read_text()
    assert "extensions:" in text and f"  {SERVER_NAME}:" in text
    assert "provider" not in text  # 空文件整体追加


def test_hermes_host_install_preserves_existing(tmp_path):
    paths = _paths(tmp_path)
    paths["hermes_mcp"].parent.mkdir(parents=True)
    paths["hermes_mcp"].write_text("mcp_servers:\n  other:\n    command: x\n")
    install_host("hermes", SCRIPT, "/tmp/starter", tmp_path / "skill", paths)
    text = paths["hermes_mcp"].read_text()
    assert "other:" in text and SERVER_NAME in text


def test_crush_host_install(tmp_path):
    paths = _paths(tmp_path)
    logs = install_host("crush", SCRIPT, "/tmp/starter", tmp_path / "skill", paths)
    assert any("已写入" in log for log in logs)
    assert f"mcp add {SERVER_NAME} " in paths["crush_mcp"].read_text()


def test_new_host_rollback(tmp_path):
    """新装文件无备份 → rollback 按既有语义跳过（只恢复到备份）。"""
    paths = _paths(tmp_path)
    install_host("cursor", SCRIPT, "/tmp/starter", tmp_path / "skill", paths)
    install_host("goose", SCRIPT, "/tmp/starter", tmp_path / "skill", paths)
    logs = rollback(paths, host="cursor")
    assert any("未找到" in log and "cursor" in log for log in logs)
    # 文件保留（无备份不删，与既有 6 host 语义一致）
    assert paths["cursor_mcp"].exists()
    logs2 = rollback(paths, host="goose")
    assert any("未找到" in log and "goose" in log for log in logs2)


def test_hosts_list_covers_full_coverage():
    expected = {"codex", "claude", "omp", "opencode", "kimi", "zcode",
                "grok", "cursor", "gemini", "pi", "copilot", "cline", "qwen",
                "devin", "windsurf", "amazon-q", "atomcode", "kiro",
                "goose", "hermes", "crush"}
    assert set(HOSTS) == expected
    assert len(HOSTS) == 21
