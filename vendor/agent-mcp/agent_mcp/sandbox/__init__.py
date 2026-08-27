"""沙箱映射层：统一策略意图 → 各 CLI 沙箱参数翻译 + 进程级兜底。

设计原则（回应"各家 CLI 不都有"）：不重复造沙箱——各家 CLI 自带沙箱/权限
（codex --sandbox、claude/grok permission-mode、omp approval-mode…），
本层把统一意图（readonly/workspace/bypass）翻译成目标 CLI 的既有参数；
对无沙箱参数的 CLI（文本捕获类）提供进程级兜底（资源限制）。

依据 docs/capability-matrix.md 实测记录。
"""
from __future__ import annotations

import os
import resource
from typing import Any

# 统一意图 → 各 CLI 参数（实测/文档依据见 capability-matrix.md）
SANDBOX_MAP: dict[str, dict[str, list[str]]] = {
    "readonly": {
        "codex": ["--sandbox", "read-only"],
        "claude": ["--permission-mode", "plan"],
        "grok": ["--permission-mode", "plan"],
        "kimi": [],                      # -p 非交互默认 auto，无沙箱 flag
        "opencode": [],                  # 权限走配置文件 allow 规则
        "omp": ["--approval-mode", "always-ask"],
        "atomcode": [],
        "copilot": [],
        "pi": [],
        "zcode": [],
        "cline": [],
    },
    "workspace": {
        "codex": ["--sandbox", "workspace-write"],
        "claude": ["--permission-mode", "acceptEdits"],
        "grok": ["--permission-mode", "acceptEdits"],
        "omp": ["--approval-mode", "write"],
        "opencode": [],
        "kimi": [],
        "atomcode": [],
        "copilot": ["--allow", "all"],
        "pi": [],
        "zcode": [],
        "cline": [],
    },
    "bypass": {
        "codex": ["--dangerously-bypass-approvals-and-sandbox"],
        "claude": ["--dangerously-skip-permissions"],
        "grok": ["--bypassPermissions", "--always-approve"],
        "omp": ["--approval-mode", "yolo", "--auto-approve"],
        "atomcode": ["--dangerously-skip-permissions"],
        "opencode": [],
        "kimi": [],
        "copilot": ["--allow", "all"],
        "pi": [],
        "zcode": [],
        "cline": [],
    },
}

# 有原生沙箱/权限参数的 CLI（其余 CLI 需进程级兜底）
_NATIVE_SANDBOX_CLIS = {"codex", "claude", "grok", "omp", "atomcode", "copilot"}


def map_sandbox(env: str, cli: str) -> list[str]:
    """统一意图 → 目标 CLI 参数列表（未知 CLI/意图 → 空列表，由进程兜底接管）。"""
    return SANDBOX_MAP.get(env, {}).get(cli, [])


def requires_process_fallback(cli: str, env: str) -> bool:
    """该 CLI 在给定意图下是否需要进程级兜底（无原生沙箱参数）。"""
    return not map_sandbox(env, cli)


def process_fallback_args(*, cpu_seconds: int = 300, max_memory_mb: int = 2048,
                          max_fds: int = 256) -> dict[str, Any]:
    """进程级兜底资源限制参数（POSIX resource.setrlimit）。

    返回 dict 供 spawn 层应用；Windows 返回空 dict（无 setrlimit，靠任务级
    超时兜底，见 dispatch.terminate_process_tree）。
    """
    if os.name == "nt":
        return {}
    return {
        "cpu_seconds": cpu_seconds,
        "max_memory_mb": max_memory_mb,
        "max_fds": max_fds,
    }


def apply_process_fallback(limits: dict[str, Any]) -> None:
    """在子进程 preexec_fn 中应用资源限制（仅 POSIX；失败静默降级）。"""
    if os.name == "nt" or not limits:
        return
    try:
        cpu = int(limits.get("cpu_seconds") or 0)
        if cpu > 0:
            resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
        mem_bytes = int(limits.get("max_memory_mb") or 0) * 1024 * 1024
        if mem_bytes > 0:
            resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
        fds = int(limits.get("max_fds") or 0)
        if fds > 0:
            resource.setrlimit(resource.RLIMIT_NOFILE, (fds, fds))
    except (ValueError, OSError):
        pass  # 限制应用失败不致命（环境差异），调度层仍有超时兜底


def sandbox_env_for(cli: str, policy_env: str = "readonly") -> dict[str, Any]:
    """编排/调度层入口：返回 (args, limits) 供 CLI 命令组装。"""
    args = map_sandbox(policy_env, cli)
    limits = process_fallback_args() if requires_process_fallback(cli, policy_env) else {}
    return {"args": args, "process_limits": limits, "cli": cli, "env": policy_env}


def build_container_sandbox_command(
    cmd_args: list[str],
    *,
    engine: str = "docker",  # docker or podman
    image: str = "python:3.12-slim",
    cwd: str = "/workspace",
    read_only: bool = False,
    network_disabled: bool = False,
    memory_limit: str = "2g",
    cpus: float = 2.0,
    mount_cwd: str | None = None,
) -> list[str]:
    """将普通 CLI 命令包装为 Docker/Podman 容器化隔离执行命令。

    设计原则：
    - 支持 docker / podman 双引擎
    - --rm: 退出即销毁容器
    - -v {host_dir}:{container_dir}:rw/ro: 挂载目标工作区
    - --read-only: 容器根文件系统只读（可选）
    - --network=none: 禁用外网（可选，用于严格只读/离线安全审计）
    - --memory / --cpus: 硬件配额硬限制
    """
    container_cmd = [engine, "run", "--rm", "-i"]
    if mount_cwd:
        mode = "ro" if read_only else "rw"
        container_cmd.extend(["-v", f"{os.path.abspath(mount_cwd)}:{cwd}:{mode}"])
    container_cmd.extend(["-w", cwd])

    if read_only:
        container_cmd.append("--read-only")
    if network_disabled:
        container_cmd.extend(["--network", "none"])
    if memory_limit:
        container_cmd.extend(["--memory", memory_limit])
    if cpus:
        container_cmd.extend(["--cpus", str(cpus)])

    container_cmd.append(image)
    container_cmd.extend(cmd_args)
    return container_cmd
