#!/usr/bin/env python3
"""agent-mcp 本地等待脚本：派发后跑一次即阻塞等 agent 终态，避免频繁调 MCP 工具。

用法（主 agent 派发 spawn_agent 后直接 shell 跑一次）：
    python3 skill/scripts/wait_agent.py <agent_id> [--timeout 600] [--interval 25] [--json]

原理：
    1. 读 daemon.json 拿写 token、daemon.lock 拿端口（缺省 8765）
    2. 循环 POST 本地回环 /api/agents/wait（timeout=interval），等终态
    3. 终态一次性输出 FINAL_ANSWER 摘要 + usage + stop_reason，然后退出

相比反复调 MCP wait_agent：本脚本是一次本地命令，内部循环不占主 agent
上下文往返；输出只有最终摘要，主 agent 只吃一次结果。

退出码：0=终态，1=参数/token 缺失，2=HTTP/JSON 错误，3=连接失败（已重试），
4=总超时（stderr 带存活证据 hint），130=中断。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

DEFAULT_PORT = 8765
# daemon 端 wait 单次阻塞上限（MAX_WAIT_SECONDS 钳制）；interval 超过会被钳，无需再大
MAX_DAEMON_WAIT = 600.0
TERMINAL = {"terminated", "error", "cancelled", "incomplete", "needs_advisor"}
# daemon 瞬时重启/连接抖动容忍：重试 3 次，间隔 2s
CONNECT_RETRIES = 3
CONNECT_RETRY_DELAY = 2.0


def find_state_dir() -> Path:
    """与 start_agent_mcp.py 同口径：AGENT_MCP_HOME / CODEX_HOME / ~/.codex。"""
    base = (os.environ.get("AGENT_MCP_HOME")
            or os.environ.get("CODEX_HOME")
            or Path.home() / ".codex")
    return Path(base) / "agent-mcp"


def read_token(state_dir: Path) -> str:
    try:
        return str(json.loads((state_dir / "daemon.json").read_text(encoding="utf-8")).get("token") or "")
    except (OSError, json.JSONDecodeError):
        return ""


def read_port(state_dir: Path) -> int:
    try:
        return int(json.loads((state_dir / "daemon.lock").read_text(encoding="utf-8")).get("port") or DEFAULT_PORT)
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return DEFAULT_PORT


class WaitHTTPError(OSError):
    """daemon 返回非 200；code/body 供上层分类提示。"""

    def __init__(self, code: int, body: str):
        super().__init__(f"HTTP {code}")
        self.code = code
        self.body = body


def wait_once(port: int, token: str, agent_id: int, timeout: float) -> dict:
    """POST /api/agents/wait 一次；返 daemon 结果 dict。非 JSON 响应抛 ValueError。
    受控回环请求（SSRF 收敛）：host 恒为 127.0.0.1 常量、port 为 int、
    路径为字面量——不构造任何 URL 字符串。非 200 抛 WaitHTTPError。"""
    import http.client
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout + 5)
    conn.request("POST", "/api/agents/wait",
                 body=json.dumps({"agent_id": agent_id, "timeout": timeout}).encode("utf-8"),
                 headers={"Content-Type": "application/json", "X-Auth-Token": token})
    resp = conn.getresponse()
    raw = resp.read().decode("utf-8")
    conn.close()
    if resp.status != 200:
        raise WaitHTTPError(resp.status, raw[:300])
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise ValueError(f"daemon 返回非 JSON 响应: {raw[:200]}")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("agent_id", type=int, help="spawn_agent 返回的 agent_id（须 >0）")
    parser.add_argument("--timeout", type=float, default=600.0, help="总等待上限秒（默认 600）")
    parser.add_argument("--interval", type=float, default=25.0,
                        help="单次 wait 阻塞秒（默认 25，daemon 上限 600 内自动钳制）")
    parser.add_argument("--json", action="store_true",
                        help="输出结构化 JSON（仅 summary/usage/stop_reason；--full-events 才带 events）")
    parser.add_argument("--full-events", action="store_true",
                        help="配合 --json：附带 events 全量（费 token，默认不带）")
    parser.add_argument("--state-dir", type=Path, default=None, help="覆盖 daemon 状态目录")
    args = parser.parse_args(argv)
    if args.agent_id <= 0:
        parser.error("agent_id 必须 >0")
    if args.timeout <= 0:
        parser.error("--timeout 必须 >0")
    if args.interval <= 0:
        parser.error("--interval 必须 >0")
    # interval 钳到 daemon 上限：避免 urlopen 先超时误报"无法连接"
    args.interval = min(args.interval, MAX_DAEMON_WAIT)
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    state_dir = args.state_dir or find_state_dir()
    token = read_token(state_dir)
    port = read_port(state_dir)

    if not token:
        print(f"error: daemon token 缺失（{state_dir}/daemon.json）；先启动 daemon", file=sys.stderr)
        return 1

    deadline = time.monotonic() + args.timeout
    last: dict = {}
    retries = 0
    try:
        while time.monotonic() < deadline:
            try:
                last = wait_once(port, token, args.agent_id, args.interval)
                retries = 0  # 连接成功后重置重试计数
            except WaitHTTPError as exc:
                err = exc.body[:300]
                if exc.code == 401:
                    print(f"error: 401 未授权——daemon 可能已重启换 token；"
                          f"重新运行 start_agent_mcp.py 或读 {state_dir}/daemon.json 的新 token", file=sys.stderr)
                elif exc.code == 400:
                    print(f"error: 请求被拒（agent_id 不存在或不属于当前会话？）：{err}", file=sys.stderr)
                else:
                    print(f"error: wait HTTP {exc.code}: {err}", file=sys.stderr)
                return 2
            except ValueError as exc:
                print(f"error: {exc}", file=sys.stderr)
                return 2
            except OSError as exc:
                # 连接抖动/daemon 瞬时重启：重试几次再退出
                retries += 1
                if retries <= CONNECT_RETRIES and time.monotonic() < deadline:
                    time.sleep(CONNECT_RETRY_DELAY)
                    continue
                print(f"error: 无法连接 daemon（127.0.0.1:{port}，重试 {retries - 1} 次）：{exc}", file=sys.stderr)
                return 3
            status = last.get("status")
            if status in TERMINAL:
                if args.json:
                    out: dict = {
                        "agent_id": last.get("agent_id"),
                        "status": status,
                        "stop_reason": last.get("stop_reason"),
                        "summary": last.get("summary"),
                        "usage": last.get("usage"),
                    }
                    if args.full_events:
                        out["events"] = last.get("events")
                        out["events_compressed"] = last.get("events_compressed")
                    print(json.dumps(out, ensure_ascii=False, indent=2))
                else:
                    summary = last.get("summary") or ""
                    if summary:
                        print(summary.strip())
                    usage = last.get("usage") or {}
                    tok = (usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
                           + usage.get("cache_creation", 0) + usage.get("cache_read", 0))
                    print(f"[{status}] stop_reason={last.get('stop_reason')} tokens={tok}")
                return 0
            # 运行中：继续下一次 wait（进度不输出，保持 stdout 干净只出终态）
        # 总超时：输出存活证据供主 agent 判断
        hint = last.get("hint") or ""
        print(f"timeout: agent {args.agent_id} 仍在 {last.get('status', 'running')}", file=sys.stderr)
        if hint:
            print(f"hint: {hint[:400]}", file=sys.stderr)
        return 4
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
