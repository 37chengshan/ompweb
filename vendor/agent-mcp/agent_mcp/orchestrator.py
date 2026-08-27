"""多 Agent 编排：DAG 调度 + Polly 模式跨厂商 worktree 协作。

设计原则：
- 不重写 dispatch.SlotScheduler（槽位调度仍归 daemon）；本模块只负责
  **任务依赖图与编排语义**，实际 spawn/wait 通过注入的回调完成。
- 同步编排（run 阻塞直至全部子任务结束或失败），便于 MCP 工具直接消费；
  并行执行用 ThreadPoolExecutor（spawner/waiter 为阻塞式 daemon HTTP 调用）。
- worktree 用可注入的 git_runner，测试注入 fake；真实环境默认 subprocess。
"""
from __future__ import annotations

import re
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_DONE = "done"
STATUS_FAILED = "failed"

# 跨厂商审查：writer 与 reviewer 不得同厂商（Polly 模式核心约束）
VENDOR_OF: dict[str, str] = {
    "claude": "anthropic", "grok": "xai", "opencode": "opencode",
    "omp": "pi", "atomcode": "atomcode", "codex": "openai",
    "kimi": "moonshot", "copilot": "github", "pi": "pi",
    "zcode": "zhipu", "cline": "cline",
}


@dataclass
class OrchestratedTask:
    """编排任务节点。deps 为前置 task_id 列表；worktree=True 时在独立 git
    worktree 中运行；review_by 指定审查者 cli（须与 cli 不同厂商）。"""
    task_id: str
    prompt: str
    deps: list[str] = field(default_factory=list)
    cli: str = "claude"
    worktree: bool = False
    review_by: str | None = None
    status: str = STATUS_QUEUED
    agent_id: int | None = None
    output: str = ""
    review: str = ""
    error: str = ""
    worktree_path: str = ""
    # v0.4 动态自优化与自愈
    max_retries: int = 0
    retry_count: int = 0
    refinement_prompt: str | None = None  # 审查未通过时的二次修正提示模版
    on_complete_hook: Callable[[OrchestratedTask, list[OrchestratedTask]], None] | None = None
    # B4: daemon 审计链产出的变更清单（file_path/change_type），供 diff-based 审查
    file_diffs: list[dict[str, Any]] = field(default_factory=list)


    def to_dict(self) -> dict[str, Any]:
        return {k: (v if not isinstance(v, list) else list(v))
                for k, v in self.__dict__.items()}


Spawner = Callable[[str, str, str | None], int]       # (prompt, cli, cwd) -> agent_id
Waiter = Callable[[int], dict[str, Any]]              # (agent_id) -> {status, summary}


class Orchestrator:
    """DAG 编排器：就绪队列 + 依赖完成推进 + 并行执行。

    spawner/waiter 为注入回调（生产：daemon spawn_agent/wait_agent 封装；
    测试：fake）。git_runner(cmd_list) -> (returncode, stdout) 供 worktree 用，
    缺省走 subprocess（仅 worktree=True 时调用）。
    """

    def __init__(self, spawner: Spawner, waiter: Waiter,
                 git_runner: Callable[[list[str]], tuple[int, str]] | None = None,
                 base_dir: str | None = None,
                 max_workers: int = 4) -> None:
        self.spawner = spawner
        self.waiter = waiter
        self.git_runner = git_runner or self._default_git_runner
        self.base_dir = base_dir
        self.max_workers = max_workers
        self.tasks: dict[str, OrchestratedTask] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _default_git_runner(cmd: list[str]) -> tuple[int, str]:
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            return proc.returncode, proc.stdout
        except Exception as exc:  # noqa: BLE001 - 编排失败不致命，记录即可
            return -1, str(exc)

    def add_task(self, task: OrchestratedTask) -> None:
        if task.task_id in self.tasks:
            raise ValueError(f"duplicate task_id: {task.task_id}")
        self.tasks[task.task_id] = task

    def _deps_met(self, task: OrchestratedTask) -> bool:
        return all(self.tasks[d].status == STATUS_DONE for d in task.deps)

    def _deps_ok(self, task: OrchestratedTask) -> bool:
        return all(d in self.tasks for d in task.deps)

    def _validate(self) -> list[str]:
        errors: list[str] = []
        for task in self.tasks.values():
            if not self._deps_ok(task):
                errors.append(f"{task.task_id}: 依赖缺失 {set(task.deps) - set(self.tasks)}")
            if task.review_by and VENDOR_OF.get(task.review_by) == VENDOR_OF.get(task.cli):
                errors.append(f"{task.task_id}: 审查者 {task.review_by} 与写者 {task.cli} 同厂商")
        return errors

    def _prepare_worktree(self, task: OrchestratedTask) -> str | None:
        if not task.worktree:
            return None
        if not self.base_dir:
            task.error = "worktree 需要 base_dir"
            return None
        # L3：task_id 仅允许安全字符，防路径逃逸（git worktree add 接受任意路径）
        safe_id = re.sub(r"[^A-Za-z0-9._-]", "_", task.task_id)
        if not safe_id:
            task.error = f"非法 task_id: {task.task_id!r}"
            return None
        branch = f"agent-{safe_id}"
        path = f"{self.base_dir.rstrip('/')}/.worktrees/{safe_id}"
        # -C base_dir：绑定用户指定的仓库，而非 daemon 进程 cwd 所在仓库
        code, out = self.git_runner(["git", "-C", self.base_dir, "worktree", "add", "-b", branch, path])
        if code != 0:
            task.error = f"git worktree add 失败: {out[:300]}"
            return None
        task.worktree_path = path
        return path

    def _cleanup_worktree(self, task: OrchestratedTask) -> None:
        """M8：任务失败/结束时清理 worktree（分支残留由用户决定，仅移除 worktree）。"""
        if not task.worktree_path or not self.base_dir:
            return
        self.git_runner(["git", "-C", self.base_dir, "worktree", "remove", "--force",
                         task.worktree_path])

    def _spawn_one(self, task: OrchestratedTask) -> None:
        cwd = self._prepare_worktree(task)
        if task.error:
            task.status = STATUS_FAILED
            return
        with self._lock:
            task.status = STATUS_RUNNING
        try:
            task.agent_id = self.spawner(task.prompt, task.cli, cwd)
        except Exception as exc:  # noqa: BLE001
            task.error = f"spawn 失败: {exc}"
            task.status = STATUS_FAILED
            self._cleanup_worktree(task)
            return
        result = self.waiter(task.agent_id)
        summary = str(result.get("summary") or "")
        status = str(result.get("status") or "error")
        # B4: 透传 daemon 审计链的变更清单，供 diff-based 审查
        diffs = result.get("file_diffs")
        if isinstance(diffs, list):
            task.file_diffs = diffs
        if status in ("terminated", "completed"):
            task.output = summary
            task.status = STATUS_DONE
        else:
            task.error = summary or f"agent 状态 {status}"
            task.status = STATUS_FAILED
            self._cleanup_worktree(task)

    def _review_and_refine_task(self, task: OrchestratedTask) -> None:
        """跨厂商审查与自动反馈闭环 (Auto-Refinement loop)。

        B4 升级：reviewer 输入从"输出摘要截断"升级为"摘要 + 审计变更清单"，
        让审查者能对照真实文件改动核对结论（数据来自 A1 修复的 file_diffs）。"""
        if not task.review_by or task.status != STATUS_DONE:
            return
        diff_lines = [f"- [{d.get('change_type')}] {d.get('file_path')}"
                      for d in task.file_diffs[:20] if isinstance(d, dict)]
        diff_block = ("\n工作区变更清单（daemon 审计，请对照摘要核实）：\n"
                      + "\n".join(diff_lines)) if diff_lines else ""
        prompt = (f"请审查以下 agent 输出（写者 CLI: {task.cli}）。"
                  f"输出摘要：\n{task.output[:2000]}\n"
                  f"{diff_block}\n"
                  f"请给出：1) 正确性结论 2) 问题清单 3) 改进建议。"
                  f"若存在严重缺陷且需要返工，请在回复首行输出 [REJECT]，否则输出 [APPROVE]。")
        try:
            agent_id = self.spawner(prompt, task.review_by, None)
            result = self.waiter(agent_id)
            review_text = str(result.get("summary") or "")
            task.review = review_text
            
            # 如果审查拒绝且允许重试修正
            if "[REJECT]" in review_text and task.retry_count < task.max_retries:
                task.retry_count += 1
                refine_prompt = (
                    f"{task.refinement_prompt}\n" if task.refinement_prompt else ""
                ) + (
                    f"前次执行未通过跨厂商审查（审查者: {task.review_by}）。\n"
                    f"审查意见：\n{review_text[:1500]}\n"
                    f"原始需求：\n{task.prompt}\n"
                    f"请根据审查意见进行针对性修复并重新完成任务。"
                )
                cwd = task.worktree_path or None
                new_agent_id = self.spawner(refine_prompt, task.cli, cwd)
                new_result = self.waiter(new_agent_id)
                new_summary = str(new_result.get("summary") or "")
                new_status = str(new_result.get("status") or "error")
                if new_status in ("terminated", "completed"):
                    task.output = new_summary
                    task.agent_id = new_agent_id
                    # 递归二次审查
                    self._review_and_refine_task(task)
                else:
                    task.error = f"重试修复失败: {new_summary}"
                    task.status = STATUS_FAILED
                    self._cleanup_worktree(task)
        except Exception as exc:  # noqa: BLE001
            task.review = f"审查失败: {exc}"

    def run(self) -> dict[str, Any]:
        """执行全部任务：按依赖拓扑推进，就绪任务并行 spawn。
        支持在节点完成时动态挂载新任务（Dynamic Task Injection）。
        返回 {tasks: [...], failed: [...], done: [...]}。"""
        errors = self._validate()
        if errors:
            return {"tasks": [t.to_dict() for t in self.tasks.values()],
                    "done": [], "failed": errors, "valid": False}

        pending = set(self.tasks)
        while pending:
            ready = [t for t in self.tasks.values()
                     if t.task_id in pending and t.status == STATUS_QUEUED
                     and self._deps_met(t)]
            if not ready:
                # 无就绪任务：剩余为依赖失败的任务，标记 failed
                for t in self.tasks.values():
                    if t.task_id in pending and t.status == STATUS_QUEUED:
                        t.status = STATUS_FAILED
                        t.error = t.error or "依赖任务失败"
                break
            with ThreadPoolExecutor(max_workers=min(self.max_workers, len(ready))) as pool:
                list(pool.map(self._spawn_one, ready))
            # 审查与自动精炼阶段
            for t in ready:
                self._review_and_refine_task(t)
                if t.status == STATUS_DONE and t.on_complete_hook:
                    new_tasks: list[OrchestratedTask] = []
                    try:
                        t.on_complete_hook(t, new_tasks)
                        for nt in new_tasks:
                            if nt.task_id not in self.tasks:
                                self.tasks[nt.task_id] = nt
                                pending.add(nt.task_id)
                    except Exception as exc:  # noqa: BLE001
                        t.error = f"on_complete_hook 执行异常: {exc}"
            pending -= {t.task_id for t in ready}

        return {
            "valid": True,
            "tasks": [t.to_dict() for t in self.tasks.values()],
            "done": [t.task_id for t in self.tasks.values() if t.status == STATUS_DONE],
            "failed": [t.task_id for t in self.tasks.values() if t.status == STATUS_FAILED],
        }


def pick_reviewer(writer_cli: str, available: list[str]) -> str | None:
    """为写者选一个不同厂商的审查 cli；无候选返回 None。"""
    writer_vendor = VENDOR_OF.get(writer_cli)
    for cli in available:
        if cli != writer_cli and VENDOR_OF.get(cli) != writer_vendor:
            return cli
    return None
