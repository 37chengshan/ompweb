"""daemon 跨进程启动锁：flock 排他持有，第二个进程直接退出不覆盖锁。"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.skipif(os.name == "nt", reason="flock is POSIX-only")
def test_daemon_startup_lock_blocks_concurrent_start(tmp_path):
    import fcntl
    repo = Path(__file__).resolve().parents[1]
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    lock_path = state_dir / "daemon.lock"
    # 模拟一个"pid 已失效"的残留锁 + 真实持锁进程：flock 必须挡住第二实例
    lock_path.write_text(json.dumps({"pid": 2147483647, "ts": 0}))
    fh = open(lock_path, "a+")
    fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        proc = subprocess.run(
            [sys.executable, "-c",
             "from agent_mcp.daemon_main import main; raise SystemExit(main())",
             "--port", "0", "--state-dir", str(state_dir)],
            cwd=str(repo), capture_output=True, text=True, timeout=10)
        assert proc.returncode == 0
        assert "already running" in (proc.stderr + proc.stdout)
        # 锁文件未被第二实例覆盖
        assert json.loads(lock_path.read_text())["pid"] == 2147483647
    finally:
        fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        fh.close()
