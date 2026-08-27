#!/usr/bin/env python3
"""Agent MCP 安装 / 迁移脚本（纯 stdlib，不 import agent_mcp）。

六个主载体（codex/claude/omp/opencode/kimi/zcode）注册同一 MCP server（mcp_server.py）：
- --install：写配置前先备份（*.bak-agentmcp-<ts>）；--dry-run 只打印不写文件
- codex：~/.codex/config.toml 末尾追加 [mcp_servers.agent-mcp]；检测旧 [mcp_servers.grok-cli]
  并提示废弃，--remove-legacy 自动移除
- claude：~/.claude.json（或 --claude-config <path>）的 mcpServers 合并写入
- omp：~/.omp/agent/mcp.json 的 mcpServers 合并写入
- opencode：~/.config/opencode/opencode.json 的 mcp 键（type=local + command 数组）
- kimi：~/.kimi-code/mcp.json（或 $KIMI_CODE_HOME）的 mcpServers 合并写入
- zcode：~/.zcode/cli/config.json 的 mcp.servers 合并写入
- 全部安装共享 skill；Codex/Claude 另安装 SessionStart launcher hook
- --rollback：从最新备份恢复（恢复后删除备份）
- --legacy-map：打印旧 9 工具 → 新 9 工具映射（breaking change 迁移表）

只做配置变更，不拷贝代码文件：默认假定 mcp_server.py 已在目标位置，
或由用户自行拷贝整个项目目录。

安装完成后提示是否 star（GitHub CLI 已登录则直接 gh repo star，否则打开浏览器）。
"""
from __future__ import annotations
import argparse
import copy
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any

SERVER_NAME = "agent-mcp"
LEGACY_NAME = "grok-cli"


def read_version() -> str:
    """读 agent_mcp/__init__.py 的 __version__（版本单一来源；纯 stdlib regex，
    本脚本刻意不 import agent_mcp 包）。"""
    init_path = Path(__file__).resolve().parent / "agent_mcp" / "__init__.py"
    try:
        match = re.search(r'^__version__\s*=\s*"([^"]+)"',
                          init_path.read_text(encoding="utf-8"), re.M)
        return match.group(1) if match else "unknown"
    except OSError:
        return "unknown"

BACKUP_SUFFIX = ".bak-agentmcp-"
HOSTS = ("codex", "claude", "omp", "opencode", "kimi", "zcode",
         "grok", "cursor", "gemini", "pi", "copilot", "cline", "qwen",
         "devin", "windsurf", "amazon-q", "atomcode", "kiro",
         "goose", "hermes", "crush")
STARTER_NAME = "start_agent_mcp.py"
HOOK_MARKER = "# agent-mcp-session-start"
GITHUB_REPO = "37chengshan/agent-mcp"
GITHUB_STAR_URL = f"https://github.com/{GITHUB_REPO}/stargazers"
# SessionStart hook 注入主代理的评判纪律：stdout 会被宿主（Claude Code）注入上下文。
# 文本避免 shell 元字符（& < > | 等），保证 posix/win 两平台 echo 均安全。
MAIN_AGENT_REMINDER = (
    "Agent MCP: 派发结果返回后按三查评判——对目标、查证据、判返工；"
    "不盲目采信，也不无谓重审。"
)

# 旧 grok-cli 9 工具 → 新 9 工具映射（breaking change；旧 skill/提示词按此迁移）
LEGACY_TOOL_MAP: list[dict[str, str]] = [
    {"old": "list_grok_models", "new": "spawn_agent",
     "note": "模型枚举无直接等价：模型选择改为 spawn_agent 的 model 参数，未指定走 CLI 默认"},
    {"old": "ask_grok", "new": "spawn_agent",
     "note": "spawn_agent(target_cli=\"grok\", permission_mode=\"plan\")；prompt 对应原提问"},
    {"old": "delegate_to_grok", "new": "spawn_agent",
     "note": "spawn_agent(target_cli=\"grok\", permission_mode=\"plan\")"},
    {"old": "delegate_to_grok_full", "new": "spawn_agent",
     "note": "spawn_agent(target_cli=\"grok\", permission_mode=\"fullAccess\")"},
    {"old": "dispatch_to_grok", "new": "spawn_agent",
     "note": "同 delegate_to_grok：spawn_agent(target_cli=\"grok\", permission_mode=\"plan\")"},
    {"old": "dispatch_to_grok_full", "new": "spawn_agent",
     "note": "同 delegate_to_grok_full：spawn_agent(target_cli=\"grok\", permission_mode=\"fullAccess\")"},
    {"old": "get_grok_dispatch_status", "new": "wait_agent / get_agent_activity",
     "note": "阻塞等结果用 wait_agent(agent_id)；查实时活动用 get_agent_activity(agent_id, since_seq)"},
    {"old": "list_grok_dispatches", "new": "list_agents",
     "note": "list_agents() 列出 agent 树；session_id 过滤会话"},
    {"old": "cancel_grok_dispatch", "new": "interrupt_agent",
     "note": "interrupt_agent(agent_id) 终止进程树并标记 cancelled"},
]


# --- 三主载体注册片段（纯函数） ---

def _toml_str(value: str) -> str:
    """TOML 基本字符串字面量（转义规则与 JSON 字符串一致）。"""
    return json.dumps(value)


def codex_registration_toml(script_path: str) -> str:
    """生成 codex config.toml 的 [mcp_servers.agent-mcp] 片段。"""
    return (
        f"[mcp_servers.{SERVER_NAME}]\n"
        f'command = {_toml_str("python3")}\n'
        f"args = [{_toml_str(script_path)}]\n"
        "startup_timeout_sec = 30\n"
    )


def claude_registration_json(script_path: str) -> dict[str, Any]:
    """生成 claude 注册对象（~/.claude.json 或项目 .mcp.json 的 mcpServers 片段）。"""
    return {
        "mcpServers": {
            SERVER_NAME: {
                "command": "python3",
                "args": [script_path],
            }
        }
    }


def omp_registration_json(script_path: str) -> dict[str, Any]:
    """生成 OMP `~/.omp/agent/mcp.json` 的 stdio server 片段。"""
    return {"mcpServers": {SERVER_NAME: {
        "type": "stdio",
        "command": "python3",
        "args": [script_path],
        "timeout": 30_000,
        "requestIdFormat": "number",
        "enabled": True,
    }}}


def opencode_registration_json(script_path: str) -> dict[str, Any]:
    """生成 opencode 配置的 mcp 键（~/.config/opencode/opencode.json）。

    opencode 的 stdio server 用 type=local + command 数组（命令与参数合并在一个数组）。
    """
    return {"mcp": {SERVER_NAME: {
        "type": "local",
        "command": ["python3", script_path],
        "enabled": True,
    }}}


def kimi_registration_json(script_path: str) -> dict[str, Any]:
    """生成 kimi 的 mcpServers 片段（~/.kimi-code/mcp.json，标准 MCP 客户端兼容格式）。"""
    return {"mcpServers": {SERVER_NAME: {
        "command": "python3",
        "args": [script_path],
    }}}


def zcode_registration_json(script_path: str) -> dict[str, Any]:
    """生成 zcode 的 mcp.servers 片段（~/.zcode/cli/config.json）。"""
    return {"mcp": {"servers": {SERVER_NAME: {
        "command": "python3",
        "args": [script_path],
        "env": {},
    }}}}


# --- v0.3 扩展注册（依据 docs/research/installer-coverage-2026-08-13.md） ---

def mcp_servers_entry(script_path: str) -> dict[str, Any]:
    """A 模板：顶层 mcpServers 的 server 对象（claude/kimi 同构）。
    覆盖 cursor/gemini/pi/copilot/cline/qwen/devin/windsurf/amazon-q/kiro。"""
    return {"command": "python3", "args": [script_path]}


def apply_mcp_servers_install(config: dict[str, Any], script_path: str) -> dict[str, Any]:
    """A 模板合并：保留其他 mcpServers 与顶层键。"""
    servers = dict(config.get("mcpServers", {}))
    servers[SERVER_NAME] = mcp_servers_entry(script_path)
    out = dict(config)
    out["mcpServers"] = servers
    return out


def grok_registration_toml(script_path: str) -> str:
    """grok 与 codex 同构（B 模板：TOML [mcp_servers]），直接复用 codex 片段。"""
    return codex_registration_toml(script_path)


def atomcode_registration_json(script_path: str) -> dict[str, Any]:
    """atomcode/Kilo 与 opencode 同构（C 模板：mcp.<name> = {type: local, command: 数组}）。"""
    return {"mcp": {SERVER_NAME: {"type": "local",
                                  "command": ["python3", script_path],
                                  "enabled": True}}}


def apply_atomcode_install(config: dict[str, Any], script_path: str) -> dict[str, Any]:
    """合并 agent-mcp 注册进 atomcode/kilo 配置的 mcp 顶层键（保留其他 server）。"""
    entry = atomcode_registration_json(script_path)["mcp"][SERVER_NAME]
    mcp = dict(config.get("mcp", {}))
    mcp[SERVER_NAME] = entry
    out = dict(config)
    out["mcp"] = mcp
    return out


def goose_registration_yaml(script_path: str) -> str:
    """goose 的 YAML extensions 块（~/.config/goose/config.yaml）。
    args 用 JSON flow 序列（对简单字符串即合法 YAML）。"""
    return (f"extensions:\n"
            f"  {SERVER_NAME}:\n"
            f"    name: {SERVER_NAME}\n"
            f"    cmd: python3\n"
            f"    args: {json.dumps([script_path])}\n"
            f"    enabled: true\n"
            f"    type: stdio\n"
            f"    timeout: 60\n"
            f"    envs: {{}}\n")


def hermes_registration_yaml(script_path: str) -> str:
    """hermes 的 YAML mcp_servers 块（~/.hermes/config.yaml，snake_case）。"""
    return (f"mcp_servers:\n"
            f"  {SERVER_NAME}:\n"
            f"    command: python3\n"
            f"    args: {json.dumps([script_path])}\n"
            f"    env: {{}}\n")


def _yaml_append_block(text: str, block: str, top_key: str) -> tuple[str, str]:
    """YAML 块合并：top_key 已存在且含 SERVER_NAME → skip；
    已存在但无 SERVER_NAME → 追加子块；否则整体追加。"""
    has_top = re.search(rf"(?m)^{re.escape(top_key)}:\s*$", text) is not None
    if has_top:
        if re.search(rf"(?m)^\s+{re.escape(SERVER_NAME)}:", text) is not None:
            return text, "skip"
        body = block.split("\n", 1)[1]
        return text.rstrip("\n") + "\n" + body, "append"
    return text.rstrip("\n") + "\n" + block, "append"


def apply_goose_install(text: str, script_path: str) -> tuple[str, str]:
    return _yaml_append_block(text, goose_registration_yaml(script_path), "extensions")


def apply_hermes_install(text: str, script_path: str) -> tuple[str, str]:
    return _yaml_append_block(text, hermes_registration_yaml(script_path), "mcp_servers")


def crush_registration_rc(script_path: str) -> str:
    """crush 的 crushrc 追加行（mcp add 命令，幂等由 apply 层保证）。"""
    return f"mcp add {SERVER_NAME} --type stdio --command python3 --args {shlex.quote(script_path)}\n"


def apply_crush_install(text: str, script_path: str) -> tuple[str, str]:
    # L7：匹配任意 agent-mcp 相关 mcp add 行（幂等判定放宽，防参数变化后重复追加）
    if re.search(rf"(?m)^\s*mcp\s+add\s+{re.escape(SERVER_NAME)}\b", text):
        return text, "skip"
    return text.rstrip("\n") + "\n" + crush_registration_rc(script_path), "append"


# --- Hook 与 skill 安装 ---


def posix_session_start_command(starter_path: str,
                                python_executable: str = sys.executable) -> str:
    command = " ".join(("nohup", shlex.quote(python_executable),
                        shlex.quote(starter_path), "--open"))
    # echo 在前台输出（Claude Code 将 SessionStart stdout 注入上下文），
    # 网页启动放后台并丢弃输出，避免 daemon JSON 污染提醒。
    return (f"echo {shlex.quote(MAIN_AGENT_REMINDER)}; "
            f"{command} >/dev/null 2>&1 & {HOOK_MARKER}")


def windows_session_start_command(starter_path: str,
                                  python_executable: str = sys.executable) -> str:
    command = subprocess.list2cmdline([python_executable, starter_path, "--open"])
    return (f'echo "{MAIN_AGENT_REMINDER}" & '
            f'start "" /B {command} >NUL 2>&1 & REM agent-mcp-session-start')


def claude_session_start_entry(starter_path: str, *, platform: str = os.name,
                               python_executable: str = sys.executable) -> dict[str, Any]:
    command = (windows_session_start_command(starter_path, python_executable)
               if platform == "nt"
               else posix_session_start_command(starter_path, python_executable))
    return {"matcher": "startup|resume",
            "hooks": [{"type": "command", "command": command, "timeout": 10}]}


def codex_session_start_entry(starter_path: str, *,
                              python_executable: str = sys.executable) -> dict[str, Any]:
    return {"matcher": "startup|resume", "hooks": [{
        "type": "command",
        "command": posix_session_start_command(starter_path, python_executable),
        "command_windows": windows_session_start_command(starter_path, python_executable),
        "timeout": 10,
    }]}


def _replace_session_start_hook(config: dict[str, Any], entry: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(config)
    hooks = out.get("hooks")
    if not isinstance(hooks, dict):
        hooks = {}
    entries = hooks.get("SessionStart")
    if not isinstance(entries, list):
        entries = []
    updated: list[Any] = []
    replaced = False
    for current in entries:
        owned = "agent-mcp-session-start" in json.dumps(current, ensure_ascii=False)
        if owned:
            if not replaced:
                updated.append(entry)
                replaced = True
            continue
        updated.append(copy.deepcopy(current))
    if not replaced:
        updated.append(entry)
    hooks["SessionStart"] = updated
    out["hooks"] = hooks
    return out


def add_claude_session_start_hook(config: dict[str, Any], starter_path: str) -> dict[str, Any]:
    return _replace_session_start_hook(config, claude_session_start_entry(starter_path))


def add_codex_session_start_hook(config: dict[str, Any], starter_path: str) -> dict[str, Any]:
    return _replace_session_start_hook(config, codex_session_start_entry(starter_path))


def _file_manifest(root: Path) -> dict[str, bytes]:
    if not root.is_dir():
        return {}
    return {str(path.relative_to(root)): path.read_bytes()
            for path in sorted(root.rglob("*")) if path.is_file()}


def skill_backup_root(destination: Path) -> Path:
    """skill 备份根目录：放 skills 扫描目录之外（上一级 /skill-backups），
    避免被宿主（codex 等）把备份目录误扫成独立 skill。"""
    return destination.parent.parent / "skill-backups"


def _skill_backup_path(destination: Path, ts: str | None = None) -> Path:
    """生成 skill 备份路径（含防碰撞），并确保备份根目录存在。"""
    stamp = ts or time.strftime("%Y%m%dT%H%M%S")
    root = skill_backup_root(destination)
    root.mkdir(parents=True, exist_ok=True)
    base = root / f"{destination.name}{BACKUP_SUFFIX}{stamp}"
    candidate = base
    suffix = 1
    while candidate.exists():
        candidate = base.with_name(f"{base.name}-{suffix}")
        suffix += 1
    return candidate


def _prune_skill_backups(destination: Path, keep: Path) -> list[str]:
    """只保留最新备份：删除该 skill 的其他备份目录，返回清理日志。"""
    root = skill_backup_root(destination)
    removed = []
    for candidate in sorted(root.glob(destination.name + f"{BACKUP_SUFFIX}*")):
        if candidate == keep:
            continue
        if candidate.is_dir():
            shutil.rmtree(candidate, ignore_errors=True)
        else:
            candidate.unlink(missing_ok=True)
        removed.append(candidate.name)
    return removed


def install_skill(source: Path, destination: Path, *, dry_run: bool = False) -> list[str]:
    """Atomically replace one final agent-mcp skill directory."""
    source = Path(source)
    destination = Path(destination)
    if _file_manifest(source) == _file_manifest(destination):
        return [f"skill {destination} 内容相同，跳过"]
    action = "更新" if destination.exists() else "创建"
    if dry_run:
        return [f"[dry-run] 将{action} skill {destination}；本次不会写入"]

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.parent / f".{destination.name}.tmp-agentmcp-{uuid.uuid4().hex}"
    backup: Path | None = None
    try:
        shutil.copytree(source, temporary)
        if destination.exists():
            backup = _skill_backup_path(destination)
            destination.replace(backup)
        temporary.replace(destination)
    except Exception:
        if temporary.exists():
            shutil.rmtree(temporary)
        if backup and backup.exists() and not destination.exists():
            backup.replace(destination)
        raise
    logs = []
    if backup:
        logs.append(f"备份 → {backup}")
        for name in _prune_skill_backups(destination, keep=backup):
            logs.append(f"清理旧备份 → {name}")
    logs.append(f"已安装 skill → {destination}")
    return logs


# --- 备份 / 文件编辑（纯函数） ---

def backup_path(target: Path, ts: str | None = None) -> Path:
    """Return a non-colliding sibling backup path."""
    stamp = ts or time.strftime("%Y%m%dT%H%M%S")
    base = target.with_name(target.name + f"{BACKUP_SUFFIX}{stamp}")
    candidate = base
    suffix = 1
    while candidate.exists():
        candidate = base.with_name(f"{base.name}-{suffix}")
        suffix += 1
    return candidate


def has_section(text: str, section: str) -> bool:
    """text 中是否存在 [section] 顶层表。"""
    return re.search(rf"(?m)^\[\s*{re.escape(section)}\s*\]\s*$", text) is not None


def find_legacy_section(text: str) -> bool:
    """codex config.toml 是否存在旧 [mcp_servers.grok-cli]。"""
    return has_section(text, f"mcp_servers.{LEGACY_NAME}")


def remove_legacy_section(text: str) -> str:
    """移除旧 [mcp_servers.grok-cli] 块（到下一个顶层表或文件末尾）。"""
    pattern = re.compile(
        rf"(?ms)^\[\s*mcp_servers\.{re.escape(LEGACY_NAME)}\s*\]\s*(?:(?!^\[)[^\n]*\n?)*"
    )
    return pattern.sub("", text)


def apply_codex_install(text: str, snippet: str) -> tuple[str, str]:
    """把 snippet 追加到 codex config.toml；已有 [mcp_servers.agent-mcp] 时返回 (原文本, "skip")。"""
    if has_section(text, f"mcp_servers.{SERVER_NAME}"):
        return text, "skip"
    if text and not text.endswith("\n"):
        text += "\n"
    if text and not text.endswith("\n\n"):
        text += "\n"
    return text + snippet.rstrip() + "\n", "append"


def apply_claude_install(config: dict[str, Any], script_path: str) -> dict[str, Any]:
    """合并 agent-mcp 注册进 claude 配置，保留其他 mcpServers 与顶层键。"""
    servers = dict(config.get("mcpServers", {}))
    servers[SERVER_NAME] = claude_registration_json(script_path)["mcpServers"][SERVER_NAME]
    out = dict(config)
    out["mcpServers"] = servers
    return out

def apply_omp_install(config: dict[str, Any], script_path: str) -> dict[str, Any]:
    """合并 agent-mcp 注册进 OMP mcp.json，保留其他服务器和顶层设置。"""
    servers = dict(config.get("mcpServers", {}))
    servers[SERVER_NAME] = omp_registration_json(script_path)["mcpServers"][SERVER_NAME]
    out = dict(config)
    out["mcpServers"] = servers
    return out


def apply_opencode_install(config: dict[str, Any], script_path: str) -> dict[str, Any]:
    """合并 agent-mcp 注册进 opencode 配置（兼容 mcp 顶层与 mcp.servers 两种结构）。"""
    entry = opencode_registration_json(script_path)["mcp"][SERVER_NAME]
    mcp = dict(config.get("mcp", {}))
    if isinstance(mcp.get("servers"), dict):
        servers = dict(mcp["servers"])
        servers[SERVER_NAME] = entry
        mcp["servers"] = servers
    else:
        mcp[SERVER_NAME] = entry
    out = dict(config)
    out["mcp"] = mcp
    return out


def apply_kimi_install(config: dict[str, Any], script_path: str) -> dict[str, Any]:
    """合并 agent-mcp 注册进 kimi mcp.json（标准 mcpServers 结构）。"""
    servers = dict(config.get("mcpServers", {}))
    servers[SERVER_NAME] = kimi_registration_json(script_path)["mcpServers"][SERVER_NAME]
    out = dict(config)
    out["mcpServers"] = servers
    return out


def apply_zcode_install(config: dict[str, Any], script_path: str) -> dict[str, Any]:
    """合并 agent-mcp 注册进 zcode config.json 的 mcp.servers。"""
    entry = zcode_registration_json(script_path)["mcp"]["servers"][SERVER_NAME]
    mcp = dict(config.get("mcp", {}))
    servers = dict(mcp.get("servers", {}))
    servers[SERVER_NAME] = entry
    mcp["servers"] = servers
    out = dict(config)
    out["mcp"] = mcp
    return out


# --- 安装执行 ---

def default_paths() -> dict[str, Path]:
    """Return the real MCP, hook, and final skill destinations."""
    home = Path.home()
    codex_home = Path(os.environ.get("CODEX_HOME", home / ".codex"))
    omp_home = Path(os.environ.get("PI_CODING_AGENT_DIR", home / ".omp" / "agent"))
    kimi_home = Path(os.environ.get("KIMI_CODE_HOME", home / ".kimi-code"))
    hermes_home = Path(os.environ.get("HERMES_HOME", home / ".hermes"))
    return {
        "codex_mcp": codex_home / "config.toml",
        "codex_hooks": codex_home / "hooks.json",
        "claude_mcp": home / ".claude.json",
        "claude_hooks": home / ".claude" / "settings.json",
        "omp_mcp": omp_home / "mcp.json",
        "opencode_mcp": home / ".config" / "opencode" / "opencode.json",
        "kimi_mcp": kimi_home / "mcp.json",
        "zcode_mcp": home / ".zcode" / "cli" / "config.json",
        "grok_mcp": home / ".grok" / "config.toml",
        "cursor_mcp": home / ".cursor" / "mcp.json",
        "gemini_mcp": home / ".gemini" / "settings.json",
        "pi_mcp": home / ".pi" / "agent" / "mcp.json",
        "copilot_mcp": home / ".copilot" / "mcp-config.json",
        "cline_mcp": home / ".cline" / "mcp.json",
        "qwen_mcp": home / ".qwen" / "settings.json",
        "devin_mcp": home / ".config" / "devin" / "mcp_config.json",
        "windsurf_mcp": home / ".codeium" / "windsurf" / "mcp_config.json",
        "amazonq_mcp": home / ".aws" / "amazonq" / "mcp.json",
        "atomcode_mcp": home / ".config" / "kilo" / "kilo.json",
        "kiro_mcp": home / ".kiro" / "settings" / "mcp.json",
        "goose_mcp": home / ".config" / "goose" / "config.yaml",
        "hermes_mcp": hermes_home / "config.yaml",
        "crush_mcp": home / ".config" / "crush" / "crushrc",
        "codex_skill": home / ".agents" / "skills" / SERVER_NAME,
        "claude_skill": home / ".claude" / "skills" / SERVER_NAME,
        "omp_skill": omp_home / "skills" / SERVER_NAME,
        "opencode_skill": home / ".config" / "opencode" / "skills" / SERVER_NAME,
        "kimi_skill": kimi_home / "skills" / SERVER_NAME,
        "zcode_skill": home / ".agents" / "skills" / SERVER_NAME,
    }


def _write_with_backup(cfg: Path) -> str:
    """Back up an existing file before its caller writes replacement content."""
    bak = backup_path(cfg)
    if cfg.exists():
        shutil.copy2(cfg, bak)
        return str(bak)
    return ""


def _load_json_object(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    if not path.exists():
        return {}, None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return None, f"错误：无法解析 {path}（{error}），未做任何修改。"
    if not isinstance(value, dict):
        return None, f"错误：{path} 顶层不是 JSON 对象，未做任何修改。"
    return value, None


def _install_json_transform(path: Path, transform, *, dry_run: bool,
                            description: str) -> list[str]:
    config, error = _load_json_object(path)
    if error:
        return [error]
    assert config is not None
    updated = transform(config)
    if updated == config:
        return [f"{description} 已存在，跳过 {path}"]
    rendered = json.dumps(updated, ensure_ascii=False, indent=2) + "\n"
    if dry_run:
        return [f"[dry-run] 将更新 {description} → {path}", rendered.rstrip()]
    backup = _write_with_backup(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(rendered, encoding="utf-8")
    logs = [f"备份 → {backup}"] if backup else []
    logs.append(f"已写入 {path}")
    return logs


def _install_text_transform(path: Path, transform, *, dry_run: bool,
                            description: str) -> list[str]:
    """文本文件（YAML/rc）追加安装：transform(text) -> (new_text, "skip"|"append")。"""
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    new_text, action = transform(text)
    if action == "skip":
        return [f"{description} 已存在，跳过 {path}"]
    if dry_run:
        return [f"[dry-run] 将更新 {description} → {path}", new_text.rstrip()]
    backup = _write_with_backup(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(new_text, encoding="utf-8")
    logs = [f"备份 → {backup}"] if backup else []
    logs.append(f"已写入 {path}")
    return logs


def _install_codex(cfg: Path, script_path: str, *, dry_run: bool,
                   remove_legacy: bool) -> list[str]:
    logs: list[str] = []
    text = cfg.read_text(encoding="utf-8") if cfg.exists() else ""
    snippet = codex_registration_toml(script_path)
    changed = False
    if find_legacy_section(text):
        logs.append(f"[deprecated] 检测到旧 [mcp_servers.{LEGACY_NAME}]（grok-cli MCP v1），"
                    f"工具已改名，建议删除；--remove-legacy 自动移除")
        if remove_legacy:
            text = remove_legacy_section(text)
            logs.append(f"已移除 [mcp_servers.{LEGACY_NAME}]")
            changed = True
    new_text, action = apply_codex_install(text, snippet)
    if action == "append":
        logs.append(f"将追加 [mcp_servers.{SERVER_NAME}] 注册（command=python3, args=[{script_path}]）")
        changed = True
    else:
        logs.append(f"[mcp_servers.{SERVER_NAME}] 已存在，跳过注册（保留现配置）")
    if not changed:
        return logs
    if dry_run:
        logs.append(f"[dry-run] 目标文件 {cfg}；本次不会写入")
        return logs
    backup = _write_with_backup(cfg)
    cfg.parent.mkdir(parents=True, exist_ok=True)
    cfg.write_text(new_text, encoding="utf-8")
    if backup:
        logs.append(f"备份 → {backup}")
    logs.append(f"已写入 {cfg}")
    return logs


def _install_claude(cfg: Path, script_path: str, *, dry_run: bool) -> list[str]:
    config, error = _load_json_object(cfg)
    if error:
        return [error]
    assert config is not None
    updated = apply_claude_install(config, script_path)
    if updated == config:
        return [f"mcpServers.{SERVER_NAME} 已存在且内容相同，跳过 {cfg}"]
    rendered = json.dumps(updated, ensure_ascii=False, indent=2) + "\n"
    if dry_run:
        return [f"[dry-run] 将更新 {cfg} 的 mcpServers.{SERVER_NAME}",
                json.dumps(updated["mcpServers"][SERVER_NAME], ensure_ascii=False, indent=2)]
    backup = _write_with_backup(cfg)
    cfg.parent.mkdir(parents=True, exist_ok=True)
    cfg.write_text(rendered, encoding="utf-8")
    logs = [f"备份 → {backup}"] if backup else []
    logs.append(f"已写入 {cfg}")
    return logs


def install_host(host: str, script_path: str, starter_path: str, skill_source: Path,
                 paths: dict[str, Path], *, dry_run: bool = False,
                 remove_legacy: bool = False) -> list[str]:
    """Install every supported surface for one host."""
    logs: list[str] = []
    if host == "codex":
        logs.extend(_install_codex(paths["codex_mcp"], script_path, dry_run=dry_run,
                                   remove_legacy=remove_legacy))
        logs.extend(_install_json_transform(
            paths["codex_hooks"],
            lambda config: add_codex_session_start_hook(config, starter_path),
            dry_run=dry_run,
            description="Codex SessionStart hook",
        ))
        logs.extend(install_skill(skill_source, paths["codex_skill"], dry_run=dry_run))
        return logs
    if host == "claude":
        logs.extend(_install_claude(paths["claude_mcp"], script_path, dry_run=dry_run))
        logs.extend(_install_json_transform(
            paths["claude_hooks"],
            lambda config: add_claude_session_start_hook(config, starter_path),
            dry_run=dry_run,
            description="Claude SessionStart hook",
        ))
        logs.extend(install_skill(skill_source, paths["claude_skill"], dry_run=dry_run))
        return logs
    if host == "omp":
        logs.extend(_install_json_transform(
            paths["omp_mcp"], lambda config: apply_omp_install(config, script_path),
            dry_run=dry_run, description="OMP mcpServers.agent-mcp"))
        logs.append("OMP 原生不支持 Claude-style SessionStart；保留 MCP 懒启动。")
        logs.extend(install_skill(skill_source, paths["omp_skill"], dry_run=dry_run))
        return logs
    if host == "opencode":
        logs.extend(_install_json_transform(
            paths["opencode_mcp"], lambda config: apply_opencode_install(config, script_path),
            dry_run=dry_run, description="opencode mcp.agent-mcp"))
        logs.append("opencode 原生不支持 Claude-style SessionStart；保留 MCP 懒启动。")
        logs.extend(install_skill(skill_source, paths["opencode_skill"], dry_run=dry_run))
        return logs
    if host == "kimi":
        logs.extend(_install_json_transform(
            paths["kimi_mcp"], lambda config: apply_kimi_install(config, script_path),
            dry_run=dry_run, description="kimi mcpServers.agent-mcp"))
        logs.append("kimi 原生不支持 Claude-style SessionStart；保留 MCP 懒启动。")
        logs.extend(install_skill(skill_source, paths["kimi_skill"], dry_run=dry_run))
        return logs
    if host == "zcode":
        logs.extend(_install_json_transform(
            paths["zcode_mcp"], lambda config: apply_zcode_install(config, script_path),
            dry_run=dry_run, description="zcode mcp.servers.agent-mcp"))
        logs.append("zcode 原生不支持 Claude-style SessionStart；保留 MCP 懒启动。")
        logs.extend(install_skill(skill_source, paths["zcode_skill"], dry_run=dry_run))
        return logs
    # ---- v0.3 扩展 host（全覆盖调研：docs/research/installer-coverage-2026-08-13.md） ----
    if host == "grok":
        # B 模板：TOML [mcp_servers]（与 codex 同构，但 grok 无 grok-cli legacy 表，
        # 直接用纯 TOML 追加，避免误用 codex 的 legacy 检测/移除逻辑，M7）
        logs.extend(_install_text_transform(
            paths["grok_mcp"],
            lambda text: apply_codex_install(text, codex_registration_toml(script_path)),
            dry_run=dry_run, description=f"[mcp_servers.{SERVER_NAME}]（grok）"))
        logs.append("grok 兼容读取 ~/.claude.json 等（compat）；装好 claude 后 grok 亦可见。")
        return logs
    if host in ("cursor", "gemini", "pi", "copilot", "cline", "qwen",
                "devin", "windsurf", "amazon-q", "kiro"):
        # A 模板：顶层 mcpServers（与 claude/kimi 同构，仅路径不同）
        mcp_key = "amazonq_mcp" if host == "amazon-q" else f"{host}_mcp"
        logs.extend(_install_json_transform(
            paths[mcp_key],
            lambda config: apply_mcp_servers_install(config, script_path),
            dry_run=dry_run, description=f"{host} mcpServers.agent-mcp"))
        logs.append(f"{host} 不支持 Claude-style SessionStart；保留 MCP 懒启动。")
        return logs
    if host == "atomcode":
        # C 模板：与 opencode 同构的 mcp 顶层键
        logs.extend(_install_json_transform(
            paths["atomcode_mcp"],
            lambda config: apply_atomcode_install(config, script_path),
            dry_run=dry_run, description="atomcode mcp.agent-mcp"))
        logs.append("atomcode 不支持 Claude-style SessionStart；保留 MCP 懒启动。")
        return logs
    if host == "goose":
        logs.extend(_install_text_transform(
            paths["goose_mcp"],
            lambda text: apply_goose_install(text, script_path),
            dry_run=dry_run, description="goose extensions.agent-mcp"))
        logs.append("goose 不支持 Claude-style SessionStart；保留 MCP 懒启动。")
        return logs
    if host == "hermes":
        logs.extend(_install_text_transform(
            paths["hermes_mcp"],
            lambda text: apply_hermes_install(text, script_path),
            dry_run=dry_run, description="hermes mcp_servers.agent-mcp"))
        logs.append("hermes 不支持 SessionStart（有 cron/gateway）；保留 MCP 懒启动。")
        return logs
    if host == "crush":
        logs.extend(_install_text_transform(
            paths["crush_mcp"],
            lambda text: apply_crush_install(text, script_path),
            dry_run=dry_run, description="crush mcp add 行"))
        logs.append("crush 暂无 SessionStart 事件；保留 MCP 懒启动。")
        return logs
    raise ValueError(f"未知 host: {host}")


# --- 回滚 ---

_ROLLBACK_KEYS = {
    "codex": ("codex_mcp", "codex_hooks", "codex_skill"),
    "claude": ("claude_mcp", "claude_hooks", "claude_skill"),
    "omp": ("omp_mcp", "omp_skill"),
    "opencode": ("opencode_mcp", "opencode_skill"),
    "kimi": ("kimi_mcp", "kimi_skill"),
    "zcode": ("zcode_mcp", "zcode_skill"),
    # v0.3 扩展 host：仅 MCP 注册（无 skill/hook 面）
    "grok": ("grok_mcp",),
    "cursor": ("cursor_mcp",),
    "gemini": ("gemini_mcp",),
    "pi": ("pi_mcp",),
    "copilot": ("copilot_mcp",),
    "cline": ("cline_mcp",),
    "qwen": ("qwen_mcp",),
    "devin": ("devin_mcp",),
    "windsurf": ("windsurf_mcp",),
    "amazon-q": ("amazonq_mcp",),
    "atomcode": ("atomcode_mcp",),
    "kiro": ("kiro_mcp",),
    "goose": ("goose_mcp",),
    "hermes": ("hermes_mcp",),
    "crush": ("crush_mcp",),
}


def rollback(paths: dict[str, Path], host: str | None = None) -> list[str]:
    """Restore the newest backup for every selected managed artifact."""
    logs: list[str] = []
    selected = HOSTS if host is None else (host,)
    for current_host in selected:
        for key in _ROLLBACK_KEYS[current_host]:
            target = paths[key]
            if key.endswith("_skill"):
                # skill 备份已移出扫描目录（skill_backup_root）
                backups = sorted(skill_backup_root(target).glob(
                    target.name + f"{BACKUP_SUFFIX}*"))
            else:
                backups = sorted(target.parent.glob(
                    target.name + f"{BACKUP_SUFFIX}*"))
            if not backups:
                logs.append(f"[{current_host}] 未找到 {target.name}{BACKUP_SUFFIX}* 备份，跳过")
                continue
            latest = backups[-1]
            if target.is_dir():
                shutil.rmtree(target)
            elif target.exists():
                target.unlink()
            latest.replace(target)
            logs.append(f"[{current_host}] 已从 {latest.name} 恢复 {target}")
    return logs


# --- 工具名映射表输出 ---

def legacy_tool_map_text() -> str:
    lines = ["旧 9 工具 → 新 9 工具映射（breaking change；旧 skill/提示词按此迁移）", ""]
    for entry in LEGACY_TOOL_MAP:
        lines.append(f"{entry['old']:28s} → {entry['new']}")
        lines.append(f"{'':28s}    {entry['note']}")
    return "\n".join(lines)


# --- CLI ---

def default_script_path() -> str:
    """默认 mcp_server.py：脚本所在目录。"""
    return str(Path(__file__).resolve().parent / "mcp_server.py")

def default_starter_path() -> Path:
    return Path(__file__).resolve().parent / STARTER_NAME


def default_skill_path() -> Path:
    return Path(__file__).resolve().parent / "skill"


# --- star 提示 ---


def _open_url(url: str) -> None:
    """用系统默认浏览器打开 URL（跨平台；失败静默，不打断安装）。"""
    try:
        if os.name == "nt":
            os.startfile(url)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", url], stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
        else:
            subprocess.Popen(["xdg-open", url], stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
    except OSError:
        pass


def prompt_star() -> None:
    """安装完成后提示 star：GitHub CLI 已登录则直接 gh repo star，否则打开浏览器。

    已 star 时 gh repo star 幂等返回非零，忽略即可；gh 缺失/未登录走浏览器兜底。
    """
    logged_in = False
    try:
        proc = subprocess.run(["gh", "auth", "status"], capture_output=True, timeout=10)
        logged_in = proc.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        pass
    if logged_in:
        try:
            subprocess.run(["gh", "repo", "star", GITHUB_REPO],
                           capture_output=True, timeout=30)
            print(f"安装完成！已通过 GitHub CLI 为 {GITHUB_REPO} 点亮 star ⭐")
            return
        except (OSError, subprocess.TimeoutExpired):
            pass
    print(f"安装完成！若觉得有用，欢迎为 {GITHUB_REPO} 点个 star ⭐")
    _open_url(GITHUB_STAR_URL)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="install.py",
        description="Agent MCP 安装/迁移：为 codex/claude/omp/opencode/kimi/zcode 注册 "
                    "mcp_server.py 并安装配套 skill。写配置前自动备份"
                    "（*.bak-agentmcp-<ts>），--rollback 可恢复。",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--install", action="store_true",
                      help="注册 MCP、SessionStart hook 与共享 skill（默认 all）")
    mode.add_argument("--rollback", action="store_true",
                      help="从最新备份恢复配置（--host 过滤）")
    mode.add_argument("--legacy-map", action="store_true",
                      help="打印旧 9 工具 → 新 9 工具映射表")
    parser.add_argument("script_path", nargs="?", default=None,
                        help="mcp_server.py 路径（默认：脚本所在目录）")
    parser.add_argument("--host", choices=[*HOSTS, "all"], default="all",
                        help="目标 host（默认 all；rollback 时同样生效）")
    parser.add_argument("--dry-run", action="store_true",
                        help="只打印将做的变更，不写任何文件")
    parser.add_argument("--remove-legacy", action="store_true",
                        help="同时移除旧 [mcp_servers.grok-cli] 注册")
    parser.add_argument("--claude-config", default=None,
                        help="仅覆盖 Claude MCP 配置文件（默认 ~/.claude.json）")
    args = parser.parse_args(argv)
    if args.rollback and args.dry_run:
        parser.error("--rollback 不能与 --dry-run 同时使用")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    if args.legacy_map:
        print(legacy_tool_map_text())
        return 0

    if args.rollback:
        paths = default_paths()
        if args.claude_config:
            paths["claude_mcp"] = Path(args.claude_config)
        print("\n".join(rollback(paths, host=None if args.host == "all" else args.host)))
        return 0

    if not args.install:
        print("未指定模式；可用 --install / --rollback / --legacy-map。", file=sys.stderr)
        return 2

    script = Path(args.script_path or default_script_path()).resolve()
    starter = default_starter_path().resolve()
    skill_source = default_skill_path().resolve()
    missing = []
    if not script.is_file():
        missing.append(f"错误：{script} 不存在。")
    if not starter.is_file():
        missing.append(f"错误：{starter} 不存在。")
    if not (skill_source / "SKILL.md").is_file():
        missing.append(f"错误：{skill_source / 'SKILL.md'} 不存在。")
    if missing:
        print("\n".join(missing), file=sys.stderr)
        return 1

    paths = default_paths()
    if args.claude_config:
        paths["claude_mcp"] = Path(args.claude_config)
    hosts: list[str] = list(HOSTS) if args.host == "all" else [args.host]
    json_keys: list[str] = []
    if "codex" in hosts:
        json_keys.append("codex_hooks")
    if "claude" in hosts:
        json_keys.extend(("claude_mcp", "claude_hooks"))
    if "omp" in hosts:
        json_keys.append("omp_mcp")
    if "opencode" in hosts:
        json_keys.append("opencode_mcp")
    if "kimi" in hosts:
        json_keys.append("kimi_mcp")
    if "zcode" in hosts:
        json_keys.append("zcode_mcp")
    errors: list[str] = []
    for key in json_keys:
        _config, error = _load_json_object(paths[key])
        if error:
            errors.append(error)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1

    print(f"agent-mcp v{read_version()} → {len(hosts)} host(s)")
    for host in hosts:
        logs = install_host(host, str(script), str(starter), skill_source, paths,
                            dry_run=args.dry_run, remove_legacy=args.remove_legacy)
        print(f"== [{host}] ==")
        print("\n".join(logs))
    if args.dry_run:
        print("（dry-run：以上均为将要执行的变更，未写任何文件）")
    else:
        prompt_star()
    return 0


if __name__ == "__main__":
    sys.exit(main())
