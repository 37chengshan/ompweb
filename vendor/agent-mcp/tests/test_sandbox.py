"""sandbox 映射层测试：统一意图 → CLI 参数翻译 + 进程兜底判定。"""
import os
from pathlib import Path

import pytest

from agent_mcp.sandbox import (
    SANDBOX_MAP, apply_process_fallback, map_sandbox, process_fallback_args,
    requires_process_fallback, sandbox_env_for,
)


def test_readonly_maps_to_codex_sandbox():
    assert map_sandbox("readonly", "codex") == ["--sandbox", "read-only"]


def test_workspace_maps_to_claude_accept_edits():
    assert map_sandbox("workspace", "claude") == ["--permission-mode", "acceptEdits"]


def test_bypass_maps_to_codex_dangerous_flag():
    assert map_sandbox("bypass", "codex") == ["--dangerously-bypass-approvals-and-sandbox"]


def test_omp_approval_mode_mapping():
    assert map_sandbox("readonly", "omp") == ["--approval-mode", "always-ask"]
    assert map_sandbox("workspace", "omp") == ["--approval-mode", "write"]
    assert map_sandbox("bypass", "omp") == ["--approval-mode", "yolo", "--auto-approve"]


def test_unknown_cli_returns_empty():
    assert map_sandbox("readonly", "nonexistent") == []


def test_unknown_env_returns_empty():
    assert map_sandbox("nonexistent", "codex") == []


def test_all_known_clis_have_readonly_entry():
    """11 个内置 CLI 都必须有 readonly 条目（策略面覆盖）。"""
    for cli in ("claude", "grok", "opencode", "omp", "atomcode", "codex",
                "kimi", "copilot", "pi", "zcode", "cline"):
        assert cli in SANDBOX_MAP["readonly"], cli


def test_requires_fallback_for_text_clis():
    """codex 有原生沙箱不需要兜底；cline/zcode/pi 需要进程兜底。"""
    assert not requires_process_fallback("codex", "readonly")
    assert requires_process_fallback("cline", "readonly")
    assert requires_process_fallback("zcode", "readonly")
    assert requires_process_fallback("pi", "workspace")


def test_process_fallback_args_shape():
    limits = process_fallback_args()
    if limits:
        assert set(limits) == {"cpu_seconds", "max_memory_mb", "max_fds"}
        assert limits["cpu_seconds"] > 0


def test_apply_process_fallback_runs_posix():
    """POSIX 上应用限制不抛异常（真实 setrlimit 生效验证）。
    M10：在独立子进程验证，避免 setrlimit 污染 pytest 进程。"""
    import os
    import subprocess
    import sys
    if os.name == "nt":
        pytest.skip("POSIX only")
    code = (
        "import sys; sys.path.insert(0, '.')"
        "; from agent_mcp.sandbox import process_fallback_args, apply_process_fallback"
        "; apply_process_fallback(process_fallback_args("
        "cpu_seconds=3600, max_memory_mb=4096, max_fds=512))"
        "; print('ok')"
    )
    proc = subprocess.run([sys.executable, "-c", code], capture_output=True,
                          text=True, timeout=30, cwd=str(Path.cwd()))
    assert proc.returncode == 0, proc.stderr
    assert "ok" in proc.stdout


def test_apply_process_fallback_empty_noop():
    apply_process_fallback({})  # 不抛即通过


def test_sandbox_env_for_composes():
    out = sandbox_env_for("codex", "workspace")
    assert out["args"] == ["--sandbox", "workspace-write"]
    assert out["process_limits"] == {}  # codex 有原生沙箱
    out2 = sandbox_env_for("cline", "readonly")
    assert out2["args"] == []
    assert "cpu_seconds" in out2["process_limits"] or os.name == "nt"
