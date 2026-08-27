#!/usr/bin/env python3
"""Idempotently start the Agent MCP daemon and optionally open its local UI."""
from __future__ import annotations

import argparse
import json
import os
import hashlib
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DAEMON = ROOT / "agent_mcp" / "daemon_main.py"
DEFAULT_PORT = 8765


def default_state_dir() -> Path:
    """与 daemon_main/mcp_server 同口径：AGENT_MCP_HOME 优先，兼容 CODEX_HOME，缺省 ~/.codex。"""
    base = (os.environ.get("AGENT_MCP_HOME")
            or os.environ.get("CODEX_HOME")
            or Path.home() / ".codex")
    return Path(base) / "agent-mcp"


DEFAULT_STATE_DIR = default_state_dir()
HEALTH_ATTEMPTS = 20
HEALTH_INTERVAL = 0.25


def daemon_command(state_dir: Path, port: int = DEFAULT_PORT) -> list[str]:
    return [sys.executable, str(DAEMON), "--port", str(port), "--state-dir", str(state_dir),
            "--web-root", str(ROOT / "web")]


def browser_command(url: str) -> list[str]:
    if os.name == "nt":
        return ["cmd", "/c", "start", "", url]
    if sys.platform == "darwin":
        return ["open", url]
    return ["xdg-open", url]

def read_token(state_dir: Path) -> str:
    try:
        token = json.loads((state_dir / "daemon.json").read_text(encoding="utf-8")).get("token")
        return str(token) if token else ""
    except (OSError, json.JSONDecodeError):
        return ""


def is_healthy(base_url: str, token: str = "") -> bool:
    try:
        with urllib.request.urlopen(f"{base_url}/health", timeout=0.8) as response:
            if response.status != 200:
                return False
            if not hasattr(response, "read"):
                return True
            body = json.loads(response.read().decode("utf-8"))
            if body.get("service") != "agent-mcp-daemon":
                return False
            expected = hashlib.sha256(token.encode("utf-8")).hexdigest() if token else ""
            return not expected or body.get("token_sha256") == expected
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return False


def start_daemon(state_dir: Path, port: int = DEFAULT_PORT) -> bool:
    base_url = f"http://127.0.0.1:{port}"
    if is_healthy(base_url, read_token(state_dir)):
        return False
    state_dir.mkdir(parents=True, exist_ok=True)
    kwargs: dict[str, object] = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "cwd": str(ROOT),
        "close_fds": True,
    }
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | getattr(
            subprocess, "DETACHED_PROCESS", 0
        )
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen(daemon_command(state_dir, port), **kwargs)
    for _ in range(HEALTH_ATTEMPTS):
        if is_healthy(base_url, read_token(state_dir)):
            return True
        time.sleep(HEALTH_INTERVAL)
    return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=int(os.environ.get("AGENT_MCP_PORT", DEFAULT_PORT)))
    parser.add_argument("--state-dir", type=Path, default=DEFAULT_STATE_DIR)
    parser.add_argument("--open", action="store_true", help="Open the local monitoring page after startup.")
    args = parser.parse_args(argv)
    base_url = f"http://127.0.0.1:{args.port}"
    started = start_daemon(args.state_dir, args.port)
    token = read_token(args.state_dir)
    if not is_healthy(base_url, token):
        print(json.dumps({"status": "error", "summary": "Agent MCP daemon did not become healthy."}))
        return 1
    url = f"{base_url}/#token={urllib.parse.quote(token, safe='')}"
    # Only open the browser when the daemon was actually started this call.
    # If the daemon was already running, the monitoring page is already open
    # (or was opened by the first start), so skip to avoid stacking tabs.
    open_browser = args.open and started
    if open_browser:
        subprocess.Popen(browser_command(url), stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=os.name != "nt")
    # When the browser is opened for the user, the write token has already
    # been delivered through the local URL fragment.  Do not duplicate it in
    # stdout, where terminal capture or automation logs may persist it.
    reported_url = f"{base_url}/" if open_browser else url
    print(json.dumps({
        "status": "started" if started else "already_running",
        "url": reported_url,
        "write_auth": "opened_in_browser" if open_browser else "url_fragment",
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
