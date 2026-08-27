import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest

import start_agent_mcp
from agent_mcp.dispatch import terminate_process_tree
from install import HOOK_MARKER, install_host
from start_agent_mcp import browser_command, daemon_command, is_healthy, main, start_daemon


def test_daemon_command_uses_project_entrypoint(tmp_path):
    state_dir = tmp_path / "agent-mcp"
    command = daemon_command(state_dir, port=9876)
    assert command == [
        sys.executable,
        str(start_agent_mcp.DAEMON),
        "--port",
        "9876",
        "--state-dir",
        str(state_dir),
        "--web-root",
        str(start_agent_mcp.ROOT / "web"),
    ]


@pytest.mark.parametrize(
    ("os_name", "platform", "expected"),
    [
        ("posix", "darwin", ["open", "http://local/"]),
        ("posix", "linux", ["xdg-open", "http://local/"]),
        ("nt", "win32", ["cmd", "/c", "start", "", "http://local/"]),
    ],
)
def test_browser_command_is_platform_specific(monkeypatch, os_name, platform, expected):
    monkeypatch.setattr(start_agent_mcp.os, "name", os_name)
    monkeypatch.setattr(start_agent_mcp.sys, "platform", platform)
    assert browser_command("http://local/") == expected


def test_is_healthy_requires_http_200(monkeypatch):
    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    seen = {}

    def fake_urlopen(url, timeout):
        seen.update(url=url, timeout=timeout)
        return Response()

    monkeypatch.setattr(start_agent_mcp.urllib.request, "urlopen", fake_urlopen)
    assert is_healthy("http://127.0.0.1:9999")
    assert seen == {"url": "http://127.0.0.1:9999/health", "timeout": 0.8}


@pytest.mark.parametrize("error", [OSError("offline"), start_agent_mcp.urllib.error.URLError("offline")])
def test_is_healthy_handles_connection_errors(monkeypatch, error):
    def fail(*_args, **_kwargs):
        raise error

    monkeypatch.setattr(start_agent_mcp.urllib.request, "urlopen", fail)
    assert not is_healthy("http://127.0.0.1:9999")


def test_start_daemon_skips_spawn_when_healthy(monkeypatch, tmp_path):
    monkeypatch.setattr(start_agent_mcp, "is_healthy", lambda _url, _token="": True)
    monkeypatch.setattr(start_agent_mcp.subprocess, "Popen", lambda *_a, **_k: pytest.fail("spawned"))
    assert start_daemon(tmp_path / "state") is False


def test_start_daemon_spawns_once_and_polls(monkeypatch, tmp_path):
    health = iter([False, False, True])
    monkeypatch.setattr(start_agent_mcp, "is_healthy", lambda _url, _token="": next(health))
    monkeypatch.setattr(start_agent_mcp.time, "sleep", lambda _seconds: None)
    calls = []
    monkeypatch.setattr(start_agent_mcp.subprocess, "Popen", lambda *a, **k: calls.append((a, k)))

    state_dir = tmp_path / "state"
    assert start_daemon(state_dir, port=9876) is True
    assert state_dir.is_dir()
    assert len(calls) == 1
    args, kwargs = calls[0]
    assert args == (daemon_command(state_dir, 9876),)
    assert kwargs["cwd"] == str(start_agent_mcp.ROOT)
    assert kwargs["close_fds"] is True
    assert kwargs["start_new_session"] is True


def test_start_daemon_returns_false_after_health_attempts(monkeypatch, tmp_path):
    checks = []
    monkeypatch.setattr(start_agent_mcp, "is_healthy", lambda url, _token="": checks.append(url) or False)
    monkeypatch.setattr(start_agent_mcp.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(start_agent_mcp.subprocess, "Popen", lambda *_a, **_k: object())
    assert start_daemon(tmp_path / "state") is False
    assert len(checks) == start_agent_mcp.HEALTH_ATTEMPTS + 1


@pytest.mark.parametrize(("started", "status"), [(True, "started"), (False, "already_running")])
def test_main_prints_structured_status(monkeypatch, tmp_path, capsys, started, status):
    monkeypatch.setattr(start_agent_mcp, "start_daemon", lambda *_a: started)
    monkeypatch.setattr(start_agent_mcp, "is_healthy", lambda _url, _token="": True)
    assert main(["--state-dir", str(tmp_path), "--port", "9876"]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["status"] == status
    assert result["url"].startswith("http://127.0.0.1:9876/#token=")


def test_main_opens_browser_only_after_health(monkeypatch, tmp_path, capsys):
    order = []
    monkeypatch.setattr(start_agent_mcp, "start_daemon", lambda *_a: order.append("start") or True)
    monkeypatch.setattr(start_agent_mcp, "is_healthy", lambda _url, _token="": order.append("health") or True)
    monkeypatch.setattr(
        start_agent_mcp.subprocess,
        "Popen",
        lambda command, **_kwargs: order.append(command),
    )
    assert main(["--state-dir", str(tmp_path), "--port", "9876", "--open"]) == 0
    assert order[:2] == ["start", "health"]
    assert order[2][0] == start_agent_mcp.browser_command("unused")[0]
    assert order[2][1].startswith("http://127.0.0.1:9876/#token=")
    assert json.loads(capsys.readouterr().out)["status"] == "started"


def test_main_error_never_opens_browser(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(start_agent_mcp, "start_daemon", lambda *_a: False)
    monkeypatch.setattr(start_agent_mcp, "is_healthy", lambda _url, _token="": False)
    monkeypatch.setattr(start_agent_mcp.subprocess, "Popen", lambda *_a, **_k: pytest.fail("opened"))
    assert main(["--state-dir", str(tmp_path), "--port", "9876", "--open"]) == 1
    assert json.loads(capsys.readouterr().out) == {
        "status": "error",
        "summary": "Agent MCP daemon did not become healthy.",
    }


def _complete_paths(tmp_path):
    return {
        "codex_mcp": tmp_path / "codex" / "config.toml",
        "codex_hooks": tmp_path / "codex" / "hooks.json",
        "claude_mcp": tmp_path / "claude.json",
        "claude_hooks": tmp_path / "claude" / "settings.json",
        "codex_skill": tmp_path / "agents" / "skills" / "agent-mcp",
        "claude_skill": tmp_path / "claude" / "skills" / "agent-mcp",
        "omp_skill": tmp_path / "omp" / "skills" / "agent-mcp",
    }


@pytest.mark.integration
def test_installed_session_hook_starts_daemon_and_opens_monitor(tmp_path):
    paths = _complete_paths(tmp_path)
    script = Path(__file__).resolve().parents[1] / "mcp_server.py"
    starter = Path(__file__).resolve().parents[1] / "start_agent_mcp.py"
    skill = Path(__file__).resolve().parents[1] / "skill"
    install_host("claude", str(script), str(starter), skill, paths)
    config = json.loads(paths["claude_hooks"].read_text())
    command = config["hooks"]["SessionStart"][0]["hooks"][0]["command"]
    assert HOOK_MARKER in command

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    state_root = tmp_path / "state-root"
    recorder = tmp_path / "open.log"
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    fake_open = fake_bin / "open"
    fake_open.write_text("#!/bin/sh\nprintf '%s\\n' \"$1\" >> \"$OPEN_RECORD\"\n")
    fake_open.chmod(0o755)
    env = os.environ.copy()
    env.update(
        AGENT_MCP_PORT=str(port),
        CODEX_HOME=str(state_root),
        OPEN_RECORD=str(recorder),
        PATH=f"{fake_bin}{os.pathsep}{env.get('PATH', '')}",
    )
    daemon_pid = None
    try:
        subprocess.run(["/bin/sh", "-c", command], env=env, check=True, timeout=10)
        deadline = time.time() + 10
        body = ""
        while time.time() < deadline:
            try:
                import http.client as _hc
                conn = _hc.HTTPConnection("127.0.0.1", port, timeout=0.5)
                conn.request("GET", "/health")
                response = conn.getresponse()
                if response.status == 200:
                    response.read()
                    conn.close()
                    conn2 = _hc.HTTPConnection("127.0.0.1", port, timeout=0.5)
                    conn2.request("GET", "/")
                    page = conn2.getresponse()
                    body = page.read().decode()
                    conn2.close()
                    break
                conn.close()
            except OSError:
                time.sleep(0.1)
        assert "Agent MCP" in body
        lock = json.loads((state_root / "agent-mcp" / "daemon.lock").read_text())
        daemon_pid = lock["pid"]
        deadline = time.time() + 5
        while time.time() < deadline and not recorder.exists():
            time.sleep(0.05)
        opened = recorder.read_text().splitlines()
        assert len(opened) == 1
        assert opened[0].startswith(f"http://127.0.0.1:{port}/#token=")

        subprocess.run(["/bin/sh", "-c", command], env=env, check=True, timeout=10)
        time.sleep(0.5)
        assert json.loads((state_root / "agent-mcp" / "daemon.lock").read_text())["pid"] == daemon_pid
    finally:
        if daemon_pid:
            terminate_process_tree(daemon_pid)
