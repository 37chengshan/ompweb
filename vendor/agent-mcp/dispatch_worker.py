#!/usr/bin/env python3
"""分离 worker：运行 CLI 命令并写 state/stdout/stderr（daemon 派发的独立进程）。

用法: python dispatch_worker.py <state.json> <stdout> <stderr> <cwd> <json_command>
      python dispatch_worker.py <state.json> <stdout> <stderr> <cwd> <timeout_seconds> <json_command>

与 grok_cli_mcp.py 的 --dispatch-worker 分支同构；自包含，不依赖 agent_mcp 包
（worker 由 daemon 以任意 cwd 分离启动）。state 文件仅含元数据，不携带密钥。
超时（timeout_seconds>0）时终止 CLI 进程树并在 state 写 timed_out=true。
"""
from __future__ import annotations
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: Path) -> dict:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_json(path: Path, data: dict) -> None:
    Path(path).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    if os.name != "nt":
        os.chmod(path, 0o600)


def terminate_tree(pid: int) -> None:
    """终止 pid 及其子孙（超时用）。优先 psutil；缺省回退进程组（POSIX）/ taskkill（Win）。"""
    if pid <= 0:
        return
    try:
        import psutil
        try:
            proc = psutil.Process(pid)
        except psutil.NoSuchProcess:
            return
        children = []
        try:
            children = proc.children(recursive=True)
        except psutil.Error:
            pass
        for child in children:
            try:
                child.terminate()
            except psutil.NoSuchProcess:
                pass
        try:
            proc.terminate()
        except psutil.NoSuchProcess:
            pass
        _, alive = psutil.wait_procs([proc] + children, timeout=3)
        for still in alive:
            try:
                still.kill()
            except psutil.NoSuchProcess:
                pass
        return
    except Exception:
        pass
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    else:
        try:
            os.killpg(os.getpgid(pid), 15)  # SIGTERM 进程组
        except (ProcessLookupError, PermissionError, OSError):
            pass


def dispatch_worker(state_path: Path, stdout_path: Path, stderr_path: Path,
                    command: list[str], cwd: Path, timeout: float = 0.0,
                    env: dict[str, str] | None = None) -> int:
    """读 state → 标 running（worker_pid）→ 运行 CLI → 标 finished（process_status）。

    timeout>0 时超限则终止 CLI 进程树，state 写 timed_out=true（daemon 映射 incomplete）。
    env 非空时 merge 到 worker 继承的环境中。"""
    state = read_json(state_path)
    state.update({"worker_pid": os.getpid(), "status": "running", "updated_at": utc_now()})
    write_json(state_path, state)
    stdout_path.parent.mkdir(parents=True, exist_ok=True)
    timed_out = False
    try:
        with stdout_path.open("w", encoding="utf-8") as out, \
                stderr_path.open("w", encoding="utf-8") as err:
            if os.name != "nt":
                os.chmod(stdout_path, 0o600)
                os.chmod(stderr_path, 0o600)
            # 独立进程组/会话：超时终止只影响 CLI 树，不波及 worker 自身
            spawn_kwargs = {}
            if os.name == "nt":
                spawn_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
            else:
                spawn_kwargs["start_new_session"] = True
            # stdin 显式 DEVNULL：CLI 读 stdin（如 opencode run 的 Bun.stdin.text()）
            # 只会拿到空串而不会误读继承输入；prompt 必须走 flag/位置参数。
            popen_kwargs = dict(cwd=cwd, stdout=out, stderr=err, stdin=subprocess.DEVNULL)
            if env:
                popen_kwargs["env"] = {**os.environ, **env}
            proc = subprocess.Popen(command, **popen_kwargs, **spawn_kwargs)
            try:
                rc = proc.wait(timeout=timeout if timeout > 0 else None)
            except subprocess.TimeoutExpired:
                # 直接子进程仍活着时终止整棵树（含孙进程），防止孤儿泄漏
                if proc.poll() is None:
                    terminate_tree(proc.pid)
                    try:
                        proc.wait(timeout=3)  # 回收直接子进程，避免僵尸
                    except subprocess.TimeoutExpired:
                        pass
                rc = -9  # 超时终止：daemon 以 timed_out 标记为准
                timed_out = True
    except OSError as exc:
        # CLI 缺失等启动失败：写错误状态，避免 state 永远停在 running
        state = read_json(state_path)
        state.update({"status": "finished", "process_status": -1, "error": str(exc),
                      "completed_at": utc_now(), "updated_at": utc_now()})
        write_json(state_path, state)
        return -1
    state = read_json(state_path)
    state.update({"status": "finished", "process_status": rc,
                  "completed_at": utc_now(), "updated_at": utc_now()})
    if timed_out:
        state["timed_out"] = True
    write_json(state_path, state)
    return rc


def main() -> int:
    if len(sys.argv) not in (6, 7, 8):
        print(__doc__, file=sys.stderr)
        return 2
    state_path = Path(sys.argv[1])
    stdout_path = Path(sys.argv[2])
    stderr_path = Path(sys.argv[3])
    cwd = Path(sys.argv[4]).resolve()
    env: dict[str, str] | None = None
    if len(sys.argv) == 8:
        try:
            env_value = json.loads(sys.argv[7])
        except json.JSONDecodeError:
            return 2
        if not isinstance(env_value, dict) or not all(
                isinstance(key, str) and isinstance(value, str)
                for key, value in env_value.items()):
            return 2
        env = env_value
    if len(sys.argv) in (7, 8):
        try:
            timeout = float(sys.argv[5])
        except ValueError:
            return 2
        command_arg = sys.argv[6]
    else:
        timeout = 0.0
        command_arg = sys.argv[5]
    try:
        command = json.loads(command_arg)
    except json.JSONDecodeError:
        return 2
    if not isinstance(command, list) or not all(isinstance(i, str) for i in command):
        return 2
    return dispatch_worker(state_path, stdout_path, stderr_path, command, cwd, timeout, env)


if __name__ == "__main__":
    raise SystemExit(main())
