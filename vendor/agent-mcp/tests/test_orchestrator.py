"""Orchestrator DAG + Polly 跨厂商协作测试（全部 fake spawner/waiter/git，不跑真实 CLI）。"""
import threading
import time

import pytest

from agent_mcp.orchestrator import (
    Orchestrator, OrchestratedTask, pick_reviewer, STATUS_DONE, STATUS_FAILED,
)


class FakeDaemon:
    """fake spawner/waiter：模拟 daemon spawn + 异步完成。"""

    def __init__(self, delay: float = 0.0, fail_ids: set[str] | None = None):
        self.next_id = 1
        self.delay = delay
        self.fail_ids = fail_ids or set()
        self.spawned: list[tuple[str, str, str | None]] = []

    def spawn(self, prompt: str, cli: str, cwd: str | None) -> int:
        # 用 prompt 前缀识别任务（fake 同步完成）
        self.spawned.append((prompt, cli, cwd))
        if self.delay:
            time.sleep(self.delay)
        return self.next_id

    def wait(self, agent_id: int) -> dict:
        if agent_id in self.fail_ids:
            return {"status": "error", "summary": "模拟失败"}
        return {"status": "terminated", "summary": f"输出-{agent_id}"}


def make_orch(fake: FakeDaemon, **kw) -> Orchestrator:
    return Orchestrator(spawner=fake.spawn, waiter=fake.wait,
                        git_runner=lambda cmd: (0, "ok"), **kw)


def test_parallel_execution_without_deps():
    fake = FakeDaemon()
    orch = make_orch(fake)
    for i in range(3):
        orch.add_task(OrchestratedTask(task_id=f"t{i}", prompt=f"p{i}"))
    result = orch.run()
    assert result["valid"] is True
    assert set(result["done"]) == {"t0", "t1", "t2"}
    assert result["failed"] == []
    assert len(fake.spawned) == 3


def test_dependency_ordering():
    """t2 依赖 t1，t1 依赖 t0：串行推进且 t2 在 t1 完成后才 spawn。"""
    fake = FakeDaemon()
    orch = make_orch(fake)
    orch.add_task(OrchestratedTask(task_id="t0", prompt="p0"))
    orch.add_task(OrchestratedTask(task_id="t1", prompt="p1", deps=["t0"]))
    orch.add_task(OrchestratedTask(task_id="t2", prompt="p2", deps=["t1"]))
    result = orch.run()
    assert set(result["done"]) == {"t0", "t1", "t2"}
    # fake 同步完成，spawned 顺序即依赖顺序
    prompts = [s[0] for s in fake.spawned]
    assert prompts.index("p0") < prompts.index("p1") < prompts.index("p2")


def test_dependency_failure_propagates():
    fake = FakeDaemon(fail_ids={1})
    orch = make_orch(fake)
    orch.add_task(OrchestratedTask(task_id="t0", prompt="p0"))
    orch.add_task(OrchestratedTask(task_id="t1", prompt="p1", deps=["t0"]))
    result = orch.run()
    assert "t0" in result["failed"]
    assert "t1" in result["failed"]  # 依赖失败 → 级联 failed


def test_missing_dependency_rejected():
    orch = make_orch(FakeDaemon())
    orch.add_task(OrchestratedTask(task_id="t0", prompt="p0", deps=["ghost"]))
    result = orch.run()
    assert result["valid"] is False
    assert any("依赖缺失" in e for e in result["failed"])


def test_duplicate_task_id_rejected():
    orch = make_orch(FakeDaemon())
    orch.add_task(OrchestratedTask(task_id="t0", prompt="p0"))
    with pytest.raises(ValueError):
        orch.add_task(OrchestratedTask(task_id="t0", prompt="p1"))


def test_same_vendor_review_rejected():
    """写者 claude（anthropic）审查者 grok（xai）合法；审查者 claude 非法。"""
    orch = make_orch(FakeDaemon())
    orch.add_task(OrchestratedTask(task_id="t0", prompt="p0",
                                   cli="claude", review_by="claude"))
    result = orch.run()
    assert result["valid"] is False
    assert any("同厂商" in e for e in result["failed"])

    orch2 = make_orch(FakeDaemon())
    orch2.add_task(OrchestratedTask(task_id="t0", prompt="p0",
                                    cli="claude", review_by="codex"))
    assert orch2.run()["valid"] is True


def test_cross_vendor_review_runs():
    fake = FakeDaemon()
    orch = make_orch(fake)
    orch.add_task(OrchestratedTask(task_id="t0", prompt="p0",
                                   cli="claude", review_by="codex"))
    result = orch.run()
    assert result["valid"] is True
    # 2 次 spawn：写者 + 审查者
    assert len(fake.spawned) == 2
    clis = [s[1] for s in fake.spawned]
    assert clis == ["claude", "codex"]
    task = orch.tasks["t0"]
    assert task.review  # 审查输出已回填


def test_worktree_created_and_spawn_cwd_points_there():
    git_calls: list[list[str]] = []

    def fake_git(cmd: list[str]) -> tuple[int, str]:
        git_calls.append(cmd)
        return 0, "ok"

    fake = FakeDaemon()
    orch = Orchestrator(spawner=fake.spawn, waiter=fake.wait,
                        git_runner=fake_git, base_dir="/repo")
    orch.add_task(OrchestratedTask(task_id="w1", prompt="p0", worktree=True))
    result = orch.run()
    assert result["valid"] is True
    assert any(cmd[:6] == ["git", "-C", "/repo", "worktree", "add", "-b"]
               for cmd in git_calls)
    # spawn cwd 指向 worktree 路径
    assert fake.spawned[0][2] == "/repo/.worktrees/w1"
    assert orch.tasks["w1"].worktree_path == "/repo/.worktrees/w1"


def test_worktree_git_failure_marks_failed():
    fake = FakeDaemon()
    orch = Orchestrator(spawner=fake.spawn, waiter=fake.wait,
                        git_runner=lambda cmd: (1, "git error"), base_dir="/repo")
    orch.add_task(OrchestratedTask(task_id="w1", prompt="p0", worktree=True))
    result = orch.run()
    assert "w1" in result["failed"]
    assert "git worktree add 失败" in orch.tasks["w1"].error
    assert fake.spawned == []  # worktree 失败不 spawn


def test_pick_reviewer_cross_vendor():
    assert pick_reviewer("claude", ["claude", "codex", "grok"]) == "codex"
    assert pick_reviewer("claude", ["claude"]) is None
    # opencode 与 omp 不同厂商
    assert pick_reviewer("omp", ["claude", "pi", "opencode"]) in ("claude", "opencode")


def test_auto_refinement_loop():
    """测试跨厂商审查拒绝后自动重试修复闭环。"""
    class RefineDaemon:
        def __init__(self):
            self.count = 0
            self.prompts = []
        def spawn(self, prompt: str, cli: str, cwd: str | None) -> int:
            self.count += 1
            self.prompts.append(prompt)
            return self.count
        def wait(self, agent_id: int) -> dict:
            if agent_id == 1:
                return {"status": "terminated", "summary": "初版代码存在 bug"}
            elif agent_id == 2:
                # codex 审查拒绝
                return {"status": "terminated", "summary": "[REJECT] 代码中有内存泄漏"}
            elif agent_id == 3:
                # 修复版本
                return {"status": "terminated", "summary": "修复了内存泄漏"}
            elif agent_id == 4:
                # 二次审查通过
                return {"status": "terminated", "summary": "[APPROVE] 审查通过"}
            return {"status": "terminated", "summary": "ok"}

    fake = RefineDaemon()
    orch = Orchestrator(spawner=fake.spawn, waiter=fake.wait, max_workers=2)
    orch.add_task(OrchestratedTask(
        task_id="t0",
        prompt="编写高性能服务",
        cli="claude",
        review_by="codex",
        max_retries=1
    ))
    result = orch.run()
    assert result["valid"] is True
    assert result["done"] == ["t0"]
    assert orch.tasks["t0"].retry_count == 1
    assert "修复了内存泄漏" in orch.tasks["t0"].output
    assert "[APPROVE]" in orch.tasks["t0"].review
    assert fake.count == 4


def test_dynamic_task_injection():
    """测试任务完成时通过 on_complete_hook 动态挂载后续子任务。"""
    fake = FakeDaemon()
    orch = make_orch(fake)

    def on_t0_done(task: OrchestratedTask, new_tasks: list[OrchestratedTask]):
        new_tasks.append(OrchestratedTask(task_id="t_dynamic", prompt="动态生成任务", deps=[task.task_id]))

    orch.add_task(OrchestratedTask(task_id="t0", prompt="初始任务", on_complete_hook=on_t0_done))
    result = orch.run()
    assert result["valid"] is True
    assert set(result["done"]) == {"t0", "t_dynamic"}
    assert len(fake.spawned) == 2

