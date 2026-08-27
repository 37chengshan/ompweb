#!/usr/bin/env python3
"""B1 实测画像一键生成：从 daemon 状态库聚合每 CLI×model 的真实成本/时长/成功率。

这是"模型×底座选型推荐体系"的第三数据源（前两个：OpenRouter 双源榜单 +
skill/cli-guide.md 静态先验）。榜单告诉你别人测的分，本脚本告诉你**你自己
的机器上**各组合的真实账单——决策权在你，数据供你参考。

用法：
    python3 scripts/harness_profile.py                 # 默认状态目录
    python3 scripts/harness_profile.py --state-dir DIR # 指定 daemon 状态目录
    python3 scripts/harness_profile.py --markdown      # 输出 Markdown 报告

纯 stdlib；数据访问复用项目 agent_mcp.db 层（只读查询），报告打印到 stdout。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agent_mcp.db import DB  # noqa: E402


def default_state_dir() -> Path:
    base = (os.environ.get("AGENT_MCP_HOME")
            or os.environ.get("CODEX_HOME")
            or str(Path.home() / ".codex"))
    return Path(base)


def load_rows(db_path: Path) -> list[dict]:
    """经项目 DB 层读取 agents 全量记录并逐个补 usage 汇总（个人规模量级足够）。"""
    db = DB(db_path)
    out: list[dict] = []
    try:
        for a in db.agents_by_session(None):
            u = db.usage_total(a["id"]) or {}
            out.append({
                "cli": a.get("cli"),
                "model": a.get("model") or "(default)",
                "status": a.get("status"),
                "created_at": a.get("created_at"),
                "finished_at": a.get("finished_at"),
                "input_tokens": int(u.get("input_tokens") or 0),
                "output_tokens": int(u.get("output_tokens") or 0),
                "cost_usd": float(u.get("cost_usd") or 0.0),
            })
    finally:
        pass
    return out


def _duration_s(created: str | None, finished: str | None) -> float | None:
    if not created or not finished:
        return None
    try:
        t0 = datetime.fromisoformat(created)
        t1 = datetime.fromisoformat(finished)
        if t0.tzinfo is None:
            t0 = t0.replace(tzinfo=timezone.utc)
        if t1.tzinfo is None:
            t1 = t1.replace(tzinfo=timezone.utc)
        return max((t1 - t0).total_seconds(), 0.0)
    except ValueError:
        return None


def aggregate(rows: list[dict]) -> list[dict]:
    groups: dict[tuple[str, str], dict] = {}
    for r in rows:
        key = (r["cli"], r["model"])
        g = groups.setdefault(key, {
            "runs": 0, "ok": 0, "failed": 0,
            "input": 0, "output": 0, "cost_usd": 0.0, "durations": []})
        g["runs"] += 1
        if r["status"] == "terminated":
            g["ok"] += 1
        elif r["status"] in ("error", "incomplete"):
            g["failed"] += 1
        g["input"] += int(r["input_tokens"] or 0)
        g["output"] += int(r["output_tokens"] or 0)
        g["cost_usd"] += float(r["cost_usd"] or 0.0)
        d = _duration_s(r["created_at"], r["finished_at"])
        if d is not None:
            g["durations"].append(d)
    out = []
    for (cli, model), g in sorted(groups.items()):
        durations = sorted(g["durations"])
        median_s = durations[len(durations) // 2] if durations else None
        decided = g["ok"] + g["failed"]
        out.append({
            "cli": cli, "model": model, "runs": g["runs"],
            "success_rate": round(g["ok"] / decided, 3) if decided else None,
            "input_tokens": g["input"], "output_tokens": g["output"],
            "cost_usd": round(g["cost_usd"], 4),
            "median_seconds": round(median_s, 1) if median_s else None,
        })
    return out


def render_markdown(stats: list[dict]) -> str:
    lines = [
        "# 底座实测画像（本地 usage 聚合）",
        "",
        f"- 生成时间：{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}"
        f" · 数据范围：daemon 状态库全部历史",
        "- 口径：success_rate = terminated / (terminated+error+incomplete)；"
        "时长为 created→finished 的中位数（含排队）。",
        "",
        "| 底座 CLI | 模型 | runs | 成功率 | 输入 tok | 输出 tok | 成本 $ | 中位时长 s |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for s in stats:
        sr = "—" if s["success_rate"] is None else s["success_rate"]
        med = "—" if s["median_seconds"] is None else s["median_seconds"]
        lines.append(
            f"| {s['cli']} | {s['model']} | {s['runs']} | {sr} "
            f"| {s['input_tokens']} | {s['output_tokens']} "
            f"| {s['cost_usd']:.4f} | {med} |")
    lines += ["", "> 参考：客观榜单见 docs/research/harness-model-benchmarks-2026-08-24.md；",
              "> 最终用哪个 CLI×模型由你显式指定，本画像仅供参考。"]
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="生成底座实测画像报表")
    parser.add_argument("--state-dir", type=Path, default=default_state_dir(),
                        help="daemon 状态目录（默认 AGENT_MCP_HOME/CODEX_HOME/~/.codex）")
    parser.add_argument("--markdown", action="store_true", help="输出 Markdown 报表")
    args = parser.parse_args()
    db_path = args.state_dir / "daemon.db"
    if not db_path.exists():
        print(f"错误：状态库不存在 {db_path}", file=sys.stderr)
        return 1
    stats = aggregate(load_rows(db_path))
    if not stats:
        print("暂无数据（还没有任何 agent 运行记录）。", file=sys.stderr)
        return 0
    if args.markdown:
        print(render_markdown(stats))
    else:
        print(json.dumps(stats, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
