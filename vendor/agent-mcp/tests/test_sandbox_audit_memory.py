import os
import tempfile
import pytest
from agent_mcp.db import DB
from agent_mcp.sandbox import build_container_sandbox_command
from agent_mcp.audit import snapshot_workspace, compute_workspace_diff


@pytest.fixture
def test_db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    db = DB(path)
    yield db
    if os.path.exists(path):
        os.remove(path)


def test_container_sandbox_builder():
    cmd = ["claude", "-p", "hello"]
    wrapped = build_container_sandbox_command(
        cmd,
        engine="docker",
        mount_cwd="/tmp/test",
        read_only=True,
        network_disabled=True,
        memory_limit="1g",
        cpus=1.5,
    )
    assert wrapped[0] == "docker"
    assert "run" in wrapped
    assert "--read-only" in wrapped
    assert "--network" in wrapped
    assert "none" in wrapped
    assert "-v" in wrapped
    assert "claude" in wrapped


def test_audit_workspace_diff():
    from pathlib import Path
    with tempfile.TemporaryDirectory() as tmpdir:
        workdir = Path(tmpdir)
        f1 = workdir / "a.txt"
        f1.write_text("initial content")

        snap1 = snapshot_workspace(tmpdir)
        assert "a.txt" in snap1

        # 修改文件，新增文件
        f1.write_text("updated content")
        f2 = workdir / "b.txt"
        f2.write_text("new file")

        snap2 = snapshot_workspace(tmpdir)
        diff = compute_workspace_diff(tmpdir, snap1, snap2)

        assert diff["modified"] == ["a.txt"]
        assert diff["added"] == ["b.txt"]
        assert diff["total_changes"] == 2
        assert "a.txt" in diff["diffs"]


def test_hybrid_memory_scoring(test_db):
    sid = "sess_hybrid"
    test_db.insert_memory(session_id=sid, content="Authentication logic with JWT tokens", key="auth_jwt", tags="security auth")
    test_db.insert_memory(session_id=sid, content="Database connection pooling in SQLite", key="db_pool", tags="database storage")
    test_db.insert_memory(session_id=sid, content="React UI dashboard design tokens", key="ui_theme", tags="frontend styling")

    # 检索关键词 "auth jwt"
    results = test_db.recall_memories(sid, query="auth jwt", limit=2)
    assert len(results) > 0
    assert results[0]["key"] == "auth_jwt"

    # 多关键词检索
    results_db = test_db.recall_memories(sid, query="SQLite storage", limit=2)
    assert len(results_db) > 0
    assert results_db[0]["key"] == "db_pool"
