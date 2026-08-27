#!/usr/bin/env python3
"""本机 host 探测 + 批量注册 agent-mcp（v3.0 会话辅助入口）。

只做两件事：
1. 探测哪些 agent CLI 真实存在于本机（二进制在 PATH，或其既有配置文件存在）；
2. 复用仓库安装器的既有函数逐 host 安装（自带备份/回滚/dry-run 契约）。

默认 dry-run 只打印计划；--apply 才真正写入。不触发 star 提示。
"""
from __future__ import annotations

import argparse
import importlib.util
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_installer():
    spec = importlib.util.spec_from_file_location("amcp_installer",
                                                  ROOT / "install.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# host → (PATH 二进制名, 既有配置文件路径)；二者任一存在即视为本机支持
DETECT = [
    ("claude", "claude", lambda home: home / ".claude.json"),
    ("codex", "codex", lambda home: home / ".codex" / "config.toml"),
    ("omp", "omp", lambda home: home / ".omp" / "agent" / "mcp.json"),
    ("opencode", "opencode", lambda home: home / ".config" / "opencode" / "opencode.json"),
    ("kimi", "kimi", lambda home: home / ".kimi-code" / "mcp.json"),
    ("zcode", "zcode", lambda home: home / ".zcode" / "cli" / "config.json"),
    ("grok", "grok", None),
    ("cursor", "cursor", None),
    ("gemini", "gemini", None),
    ("pi", "pi", None),
    ("copilot", "copilot", None),
    ("cline", "cline", None),
    ("qwen", "qwen", None),
    ("devin", "devin", None),
    ("windsurf", "windsurf", None),
    ("amazon-q", "q", None),
    ("atomcode", "atomcode", None),
    ("kiro", "kiro", None),
    ("goose", "goose", None),
    ("hermes", "hermes", None),
    ("crush", "crush", None),
]


def detect_hosts() -> list[str]:
    home = Path.home()
    found = []
    for host, binary, cfg_of in DETECT:
        if shutil.which(binary):
            found.append(host)
        elif cfg_of is not None and cfg_of(home).is_file():
            found.append(host)
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description="为本机存在的 agent 注册 agent-mcp")
    parser.add_argument("--apply", action="store_true",
                        help="真正写入（缺省为 dry-run 预览）")
    parser.add_argument("--hosts", default="",
                        help="逗号分隔覆盖自动探测（如 claude,codex）")
    args = parser.parse_args()

    inst = load_installer()
    hosts = [h.strip() for h in args.hosts.split(",") if h.strip()] \
        if args.hosts else detect_hosts()
    invalid = [h for h in hosts if h not in inst.HOSTS]
    if invalid:
        print(f"未知 host: {invalid}", file=sys.stderr)
        return 2
    if not hosts:
        print("未探测到任何本地支持的 agent CLI。", file=sys.stderr)
        return 1

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[{mode}] 目标 {len(hosts)} 个 host：{' '.join(hosts)}")
    script = inst.default_script_path()
    starter = inst.default_starter_path().resolve()
    skill_source = inst.default_skill_path().resolve()
    paths = inst.default_paths()

    failures: list[str] = []
    for host in hosts:
        logs = inst.install_host(host, script, str(starter.resolve()),
                                 skill_source, paths,
                                 dry_run=not args.apply, remove_legacy=False)
        print(f"== [{host}] ==")
        ok_lines = [l for l in logs if "错误" not in l]
        err_lines = [l for l in logs if "错误" in l]
        print("\n".join(ok_lines[-2:]) if ok_lines else "(无输出)")
        if err_lines:
            failures.append(host)
            print("\n".join(err_lines))
    print(f"\n完成：{len(hosts) - len(failures)} 成功 / {len(failures)} 失败"
          f"{('：' + ','.join(failures)) if failures else ''}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
