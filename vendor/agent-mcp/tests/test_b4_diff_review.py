"""B4 diff-based Polly 审查测试。

升级前 reviewer 只看"输出摘要前 2000 字"，容易与真实改动脱节；
升级后 daemon 把审计链（file_diffs）随 wait 结果透传，编排层把
变更清单拼进审查提示词，让审查者对照真实文件改动核对。
"""
import json

from agent_mcp.daemon_http import EventBroadcaster
from agent_mcp.daemon_main import Dispatcher
from agent_mcp.db import DB
from agent_mcp.orchestrator import OrchestratedTask, Orchestrator


class FakeDaemon:
    def __init__(self, file_diffs=None):
        self.spawned = []
        self.reviews = []
        self.file_diffs = file_diffs or []

    def spawn(self, prompt, cli, cwd):
        self.spawned.append((prompt, cli, cwd))
        return len(self.spawned)

    def wait(self, agent_id):
        # writer=1 返回带审计清单的终态；reviewer(2) 返回 APPROVE
        if agent_id == 1:
            return {"status": "terminated", "summary": "done",
                    "file_diffs": self.file_diffs}
        return {"status": "terminated", "summary": "[APPROVE] ok"}


def run_orch(file_diffs):
    fake = FakeDaemon(file_diffs)
    orch = Orchestrator(spawner=fake.spawn, waiter=fake.wait)
    orch.add_task(OrchestratedTask(task_id="t0", prompt="p0", cli="claude",
                                   review_by="codex"))
    result = orch.run()
    return fake, orch, result


def test_reviewer_prompt_includes_audit_diff_list():
    diffs = [{"file_path": "a.py", "change_type": "modified"},
             {"file_path": "b_new.py", "change_type": "added"}]
    fake, orch, result = run_orch(diffs)
    assert result["valid"] is True
    writer_prompt, reviewer_cli, _ = fake.spawned[1]
    assert reviewer_cli == "codex"
    assert "工作区变更清单" in writer_prompt
    assert "- [modified] a.py" in writer_prompt
    assert "- [added] b_new.py" in writer_prompt


def test_reviewer_prompt_without_diffs_has_no_block():
    fake, orch, result = run_orch([])
    assert result["valid"] is True
    writer_prompt, _, _ = fake.spawned[1]
    assert "工作区变更清单" not in writer_prompt


def test_task_carries_file_diffs_for_downstream():
    fake, orch, _ = run_orch([{"file_path": "x.txt", "change_type": "added"}])
    assert orch.tasks["t0"].file_diffs == [
        {"file_path": "x.txt", "change_type": "added"}]


# ---- daemon 侧：wait 终态结果附带 file_diffs ----

def test_wait_result_attaches_file_diffs(tmp_path):
    db = DB(tmp_path / "d.sqlite3")
    disp = Dispatcher(db=db, broadcaster=EventBroadcaster(),
                      state_dir=tmp_path / "state", spawn_fn=lambda *a, **k: {})
    agent_id = db.insert_agent(parent_id=None, session_id="s4",
                               task_name="diff-case", cli="claude",
                               cwd=str(tmp_path))
    db.record_file_diff(agent_id=agent_id, session_id="s4",
                        file_path="a.py", change_type="modified",
                        diff_content="--- a/a.py")
    db.set_status(agent_id, "terminated", stop_reason="end_turn")

    result = disp._wait_result(db.get_agent(agent_id), "", 600)
    assert result["file_diffs"] == [{"file_path": "a.py",
                                     "change_type": "modified"}]
