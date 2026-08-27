"""Launcher (start_agent_mcp.py) 契约：默认 state dir 与 daemon/mcp_server 同口径。

daemon_main.default_state_dir / mcp_server.state_dir_from_env 均为
AGENT_MCP_HOME > CODEX_HOME > ~/.codex，launcher 必须一致，否则 mcp_server
探测的 daemon.json 与 launcher 实际拉起的 daemon 可能分属不同 state dir。
"""
from pathlib import Path
import json

import start_agent_mcp


def test_launcher_default_state_dir_prefers_agent_mcp_home(monkeypatch):
    monkeypatch.delenv("AGENT_MCP_HOME", raising=False)
    monkeypatch.setenv("CODEX_HOME", "/tmp/codexhome")
    assert start_agent_mcp.default_state_dir() == Path("/tmp/codexhome") / "agent-mcp"

    monkeypatch.setenv("AGENT_MCP_HOME", "/tmp/amh")
    assert start_agent_mcp.default_state_dir() == Path("/tmp/amh") / "agent-mcp"


def test_launcher_default_state_dir_falls_back_to_codex_home_dir(monkeypatch):
    monkeypatch.delenv("AGENT_MCP_HOME", raising=False)
    monkeypatch.delenv("CODEX_HOME", raising=False)
    assert start_agent_mcp.default_state_dir() == Path.home() / ".codex" / "agent-mcp"


def test_launcher_open_skips_browser_when_already_running(monkeypatch, tmp_path, capsys):
    """Daemon already running + --open → 不打开浏览器，token 通过 URL fragment 传递。"""
    token = "sensitive-write-token"
    opened = []
    monkeypatch.setattr(start_agent_mcp, "start_daemon", lambda *_args: False)
    monkeypatch.setattr(start_agent_mcp, "read_token", lambda _state_dir: token)
    monkeypatch.setattr(start_agent_mcp, "is_healthy", lambda *_args: True)
    monkeypatch.setattr(
        start_agent_mcp.subprocess,
        "Popen",
        lambda command, **_kwargs: opened.append(command),
    )

    assert start_agent_mcp.main([
        "--state-dir",
        str(tmp_path),
        "--port",
        "9876",
        "--open",
    ]) == 0

    payload = json.loads(capsys.readouterr().out)
    assert payload == {
        "status": "already_running",
        "url": "http://127.0.0.1:9876/#token=sensitive-write-token",
        "write_auth": "url_fragment",
    }
    assert token in json.dumps(payload)  # token in URL fragment, not in browser
    assert len(opened) == 0  # browser was NOT opened


def test_launcher_open_opens_browser_when_started(monkeypatch, tmp_path, capsys):
    """Daemon freshly started + --open → 打开浏览器，token 不打印到 stdout。"""
    token = "sensitive-write-token"
    opened = []
    monkeypatch.setattr(start_agent_mcp, "start_daemon", lambda *_args: True)
    monkeypatch.setattr(start_agent_mcp, "read_token", lambda _state_dir: token)
    monkeypatch.setattr(start_agent_mcp, "is_healthy", lambda *_args: True)
    monkeypatch.setattr(
        start_agent_mcp.subprocess,
        "Popen",
        lambda command, **_kwargs: opened.append(command),
    )

    assert start_agent_mcp.main([
        "--state-dir",
        str(tmp_path),
        "--port",
        "9876",
        "--open",
    ]) == 0

    payload = json.loads(capsys.readouterr().out)
    assert payload == {
        "status": "started",
        "url": "http://127.0.0.1:9876/",
        "write_auth": "opened_in_browser",
    }
    assert token not in json.dumps(payload)
    assert len(opened) == 1
    assert token in opened[0][-1]
