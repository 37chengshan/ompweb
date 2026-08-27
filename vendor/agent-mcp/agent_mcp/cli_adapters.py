from __future__ import annotations
import re
import json
import shutil
import sys
from pathlib import Path
from typing import Any

HOME = Path.home()

class ResumeUnsupportedError(ValueError):
    pass


class BaseAdapter:
    cli_name = ""
    # B2 usage 结算语义声明（daemon 统一结算的依据，禁止各处凭感觉处理）：
    # - "authoritative"：适配器产出的最后一条非空 usage 即该 run 的权威总量，
    #   daemon 可整体覆盖；尾随空/零总量不得覆盖既有累计（防清账）。
    # - "cumulative"  ：每条 usage 为"至今累计"，daemon 取最新覆盖即可；
    #   同样禁止在 daemon 层二次累加（会双计）。
    # 仅允许这两个值，见 tests/test_b2_usage_contract.py。
    usage_semantics: str = "authoritative"
    def build_command(self, *, prompt: str, cwd: str, model: str | None,
                      permission_mode: str, max_turns: int, resume: str | None) -> list[str]:
        raise NotImplementedError
    def parse_stream(self, lines: list[str]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        """返回 (规范化事件列表, 累计 usage dict)"""
        raise NotImplementedError
    def extract_session_id(self, raw: dict) -> str | None:
        return None
    def binary(self) -> str | None:
        return None


class ClaudeAdapter(BaseAdapter):
    cli_name = "claude"
    _BIN = ["claude", str(HOME / ".local/bin/claude")]
    PERMISSION_FLAGS = {
        "plan": ["--permission-mode", "plan"],
        "acceptEdits": ["--permission-mode", "acceptEdits"],
        "fullAccess": ["--dangerously-skip-permissions"],
    }
    def binary(self) -> str | None:
        for cand in self._BIN:
            found = shutil.which(cand)
            if found:
                return found
        return None
    def build_command(self, *, prompt, cwd, model=None, permission_mode="plan",
                      max_turns=8, resume=None) -> list[str]:
        # claude 2.1.220 不支持 --cwd flag（实测 unknown option），工作目录
        # 由 subprocess 层 cwd= 覆盖（dispatch_worker.py 的 subprocess.run 已有）；
        # cwd 参数按接口保留但不进命令
        cmd = [self.binary(), "-p", "--output-format", "stream-json", "--verbose",
               "--max-turns", str(max_turns)]
        cmd += self.PERMISSION_FLAGS.get(permission_mode, self.PERMISSION_FLAGS["plan"])
        if model:
            cmd += ["--model", model]
        if resume:
            cmd += ["--resume", resume]
        cmd.append(prompt)
        return cmd
    def parse_stream(self, lines) -> tuple[list[dict], dict]:
        events: list[dict] = []
        usage: dict[str, Any] = {}
        seen_ids: set[str] = set()
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(raw, dict):
                continue
            typ = raw.get("type")
            if typ == "assistant" and isinstance(raw.get("message"), dict):
                usage = _assistant_event(events, usage, seen_ids, raw["message"])
            elif typ == "result":
                # result.usage 是会话最终权威值，直接覆盖（而非累加）。
                # claude 2.1.220 实测 result 行是顶层结构（is_error/usage 与 type
                # 平级，与 grok 同构）；兼容 T4 沿用的嵌套 result 假设
                res = raw.get("result") if isinstance(raw.get("result"), dict) else raw
                u = res.get("usage") or {}
                usage = {
                    "input_tokens": _num(u.get("input_tokens")),
                    "output_tokens": _num(u.get("output_tokens")),
                    "cache_creation": _num(u.get("cache_creation_input_tokens")),
                    "cache_read": _num(u.get("cache_read_input_tokens")),
                    "cost_usd": _num(res.get("total_cost_usd")),
                }
                events.append({"type": "agent.usage", "payload": dict(usage)})
                sid = res.get("session_id")
                if sid:
                    events.append({"type": "agent.terminated",
                                   "payload": {"stop_reason": res.get("stop_reason", "end_turn"),
                                               "session_id": sid}})
        usage = _normalize_usage(usage)  # P6: 统一口径
        return events, usage


class GrokAdapter(ClaudeAdapter):
    cli_name = "grok"
    _BIN = ["grok", str(HOME / ".grok/bin/grok")]
    PERMISSION_FLAGS = {
        # plan 模式禁用子代理（只读规划，不让子代理扩散执行）
        "plan": ["--permission-mode", "plan", "--no-subagents"],
        "acceptEdits": ["--permission-mode", "acceptEdits"],
        "fullAccess": ["--permission-mode", "bypassPermissions", "--always-approve"],
    }
    def build_command(self, *, prompt, cwd, model=None, permission_mode="plan",
                      max_turns=8, resume=None) -> list[str]:
        cmd = [self.binary(), "--cwd", str(cwd), "--output-format",
               "streaming-messages-json", "--max-turns", str(max_turns)]
        cmd += self.PERMISSION_FLAGS.get(permission_mode, self.PERMISSION_FLAGS["plan"])
        if model:
            cmd += ["--model", model]
        if resume:
            cmd += ["--resume", resume]
        cmd += ["--single", prompt]
        return cmd
    def parse_stream(self, lines) -> tuple[list[dict], dict]:
        # grok streaming-messages-json 实测（0.2.118）：assistant/result 行与
        # claude 同构（snake_case）；assistant.message.content 为 thinking/text 块数组
        events: list[dict] = []
        usage: dict[str, Any] = {}
        seen_ids: set[str] = set()
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(raw, dict):
                continue
            typ = raw.get("type")
            if typ == "assistant" and isinstance(raw.get("message"), dict):
                usage = _assistant_event(events, usage, seen_ids, raw["message"])
            elif typ == "result":
                # grok 实测：usage/stop_reason/session_id/total_cost_usd 在顶层，
                # result 字段只是最终输出文本（与 claude 的嵌套 result 不同）
                res = raw
                u = res.get("usage") or {}
                usage = {
                    "input_tokens": _num(u.get("input_tokens")),
                    "output_tokens": _num(u.get("output_tokens")),
                    "cache_creation": _num(u.get("cache_creation_input_tokens")),
                    "cache_read": _num(u.get("cache_read_input_tokens")),
                    "cost_usd": _num(res.get("total_cost_usd")),
                }
                events.append({"type": "agent.usage", "payload": dict(usage)})
                sid = res.get("session_id")
                if sid:
                    events.append({"type": "agent.terminated",
                                   "payload": {"stop_reason": res.get("stop_reason", "end_turn"),
                                               "session_id": sid}})
        usage = _normalize_usage(usage)  # P6: 统一口径
        return events, usage
    def extract_session_id(self, raw: dict) -> str | None:
        # system init / assistant / result 行均带顶层 session_id（实测）
        sid = raw.get("session_id") if isinstance(raw, dict) else None
        return str(sid) if sid else None


class OpencodeAdapter(ClaudeAdapter):
    cli_name = "opencode"
    _BIN = ["opencode"]
    # B2：opencode 的 usage 为逐 turn 累计口径（实测），daemon 取最新覆盖
    usage_semantics = "cumulative"
    # opencode 无 permission-mode CLI flag（权限走配置文件 allow 规则），
    # 仅 fullAccess 对应 --dangerously-skip-permissions（实测 1.14.51）
    PERMISSION_FLAGS = {
        "fullAccess": ["--dangerously-skip-permissions"],
    }
    def build_command(self, *, prompt, cwd, model=None, permission_mode="plan",
                      max_turns=8, resume=None) -> list[str]:
        cmd = [self.binary(), "run", "--format", "json", "--dir", str(cwd)]
        cmd += self.PERMISSION_FLAGS.get(permission_mode, [])
        if model:
            cmd += ["--model", model]
        if resume:
            cmd += ["--session", resume]
        cmd.append(prompt)
        return cmd
    def parse_stream(self, lines) -> tuple[list[dict], dict]:
        # opencode run --format json 实测（1.14.51）：事件仅
        # step_start/text/tool_use/step_finish；usage 在 step_finish.part.tokens。
        # 无 agent.terminated 为有意设计，终止判定由 dispatch 层 exit code 兜底；
        # 但为让 daemon 回填 cli_session_id（resume 用），从事件顶层 sessionID
        # 收集会话 id，在末尾产出一条仅带 session_id 的 terminated（daemon
        # _ingest_output 只回填不落库不广播，不影响状态机）。
        events: list[dict] = []
        usage: dict[str, Any] = {}
        session_id: str | None = None
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(raw, dict):
                continue
            sid = raw.get("sessionID")
            if isinstance(sid, str) and sid and session_id is None:
                session_id = sid
            typ = raw.get("type")
            part = raw.get("part") if isinstance(raw.get("part"), dict) else {}
            if typ == "text":
                events.append({"type": "agent.message",
                               "payload": {"text": part.get("text", "")}})
            elif typ == "tool_use":
                state = part.get("state") if isinstance(part.get("state"), dict) else {}
                events.append({"type": "agent.tool_use", "payload": {
                    "name": part.get("tool", ""),
                    "input": state.get("input") or {},
                    "output": state.get("output", ""),
                }})
            elif typ == "step_finish":
                # step_finish.tokens 为每步增量；若上游版本改为累计值则 usage 翻倍
                tokens = part.get("tokens") if isinstance(part.get("tokens"), dict) else {}
                cache = tokens.get("cache") if isinstance(tokens.get("cache"), dict) else {}
                usage = _merge_usage(usage, {
                    "input_tokens": _num(tokens.get("input")),
                    "output_tokens": _num(tokens.get("output")),
                    "cache_creation": _num(cache.get("write")),
                    "cache_read": _num(cache.get("read")),
                    "reasoning_tokens": _num(tokens.get("reasoning")),
                    "cost_usd": _num(part.get("cost")),
                })
                events.append({"type": "agent.usage", "payload": dict(usage)})
        if session_id:
            events.append({"type": "agent.terminated",
                           "payload": {"session_id": session_id}})
        usage = _normalize_usage(usage)  # P6: 统一口径
        return events, usage
    def extract_session_id(self, raw: dict) -> str | None:
        # 实测：所有事件带顶层 sessionID（camelCase）
        sid = raw.get("sessionID") if isinstance(raw, dict) else None
        return str(sid) if sid else None


class OmpAdapter(ClaudeAdapter):
    cli_name = "omp"
    _BIN = ["omp", str(HOME / ".bun/bin/omp")]
    # B2：omp 的 usage 为逐 turn 累计口径（实测），daemon 取最新覆盖
    usage_semantics = "cumulative"
    # omp 无 max-turns flag（有 --max-time），max_turns 参数按接口保留但忽略；
    # 权限映射基于 --approval-mode (always-ask|write|yolo) / --auto-approve
    PERMISSION_FLAGS = {
        "plan": ["--approval-mode", "always-ask"],
        "acceptEdits": ["--approval-mode", "write"],
        "fullAccess": ["--approval-mode", "yolo", "--auto-approve"],
    }
    def build_command(self, *, prompt, cwd, model=None, permission_mode="plan",
                      max_turns=8, resume=None) -> list[str]:
        cmd = [self.binary(), "--print", "--mode", "json", "--cwd", str(cwd)]
        cmd += self.PERMISSION_FLAGS.get(permission_mode, self.PERMISSION_FLAGS["plan"])
        if model:
            cmd += ["--model", model]
        if resume:
            cmd += ["--resume", resume]
        cmd.append(prompt)
        return cmd
    def parse_stream(self, lines) -> tuple[list[dict], dict]:
        # omp -p --mode=json 实测（17.2.4）：session/agent_start/turn_start/
        # message_start/message_update(text_delta)/message_end/turn_end/agent_end；
        # usage 权威值在 assistant message_end（message_start 为 0 占位），
        # 字段 camelCase（input/output/cacheRead/cacheWrite/cost.total）
        events: list[dict] = []
        usage: dict[str, Any] = {}
        session_id = ""
        last_stop_reason = ""
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(raw, dict):
                continue
            typ = raw.get("type")
            if typ == "session" and raw.get("id"):
                session_id = str(raw["id"])
            elif typ == "message_update":
                ev = raw.get("assistantMessageEvent")
                if isinstance(ev, dict) and ev.get("type") == "text_delta":
                    events.append({"type": "agent.message_delta",
                                   "payload": {"delta": ev.get("delta", "")}})
            elif typ == "message_end" and isinstance(raw.get("message"), dict):
                msg = raw["message"]
                events.append({"type": "agent.message",
                               "payload": {"text": _extract_text(msg.get("content"))}})
                stop = msg.get("stopReason")
                if stop:
                    last_stop_reason = str(stop)
                if isinstance(msg.get("usage"), dict):
                    # 实测（17.2.4 多 turn：两次工具调用）：message_end.usage 是
                    # 每 turn 增量而非会话累计（第二 turn cacheRead 36608 < 第一 turn
                    # 56832，累计值不可能下降）→ 与 opencode 同语义，累加
                    u = msg["usage"]
                    cost = u.get("cost") if isinstance(u.get("cost"), dict) else {}
                    usage = _merge_usage(usage, {
                        "input_tokens": _num(u.get("input")),
                        "output_tokens": _num(u.get("output")),
                        "cache_creation": _num(u.get("cacheWrite")),
                        "cache_read": _num(u.get("cacheRead")),
                        "reasoning_tokens": _num(u.get("reasoningTokens")),
                        "cost_usd": _num(cost.get("total")),
                    })
                    events.append({"type": "agent.usage", "payload": dict(usage)})
            elif typ == "agent_end":
                stop = last_stop_reason or ("end_turn" if raw.get("isTerminal") else "unknown")
                events.append({"type": "agent.terminated",
                               "payload": {"stop_reason": stop,
                                           "session_id": session_id}})
        usage = _normalize_usage(usage)  # P6: 统一口径
        return events, usage
    def extract_session_id(self, raw: dict) -> str | None:
        # 实测：session 事件顶层 id
        sid = raw.get("id") if isinstance(raw, dict) else None
        return str(sid) if sid else None



class AtomCodeAdapter(BaseAdapter):
    cli_name = "atomcode"
    _BIN = ["atomcode", str(HOME / ".local/bin/atomcode")]
    # AtomCode 5.0.3 bundled docs advertise --disable-tools, but the installed
    # binary rejects it. Keep plan/acceptEdits at native approval defaults;
    # only fullAccess elevates with the verified -y flag.

    def binary(self) -> str | None:
        for candidate in self._BIN:
            resolved = shutil.which(candidate)
            if resolved:
                return resolved
        return None

    def build_command(self, *, prompt: str, cwd: str, model: str | None,
                      permission_mode: str, max_turns: int,
                      resume: str | None) -> list[str]:
        if resume:
            raise ResumeUnsupportedError("AtomCode does not support stable session-id resume")
        command = [self.binary(), "-C", str(cwd)]
        if model:
            command.extend(("--model", model))
        if permission_mode == "fullAccess":
            command.append("--dangerously-skip-permissions")
        command.extend(("-v", "-p", prompt))
        return command

    def parse_stream(self, lines: list[str]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        visible: list[str] = []
        usage: dict[str, Any] = {}
        for raw_line in lines:
            line = raw_line.rstrip("\n")
            match = re.fullmatch(
                r"\[tokens\]\s+prompt=(\d+)\s+completion=(\d+)\s+cached=(\d+)",
                line.strip())
            if match:
                # cached 应计入 cache_read 且加进 input_tokens（原实现漏算 input）
                usage = {"input_tokens": int(match.group(1)) + int(match.group(3)),
                         "output_tokens": int(match.group(2)),
                         "cache_creation": 0, "cache_read": int(match.group(3)),
                         "cost_usd": 0.0}
                continue
            if line.lstrip().startswith("[done]"):
                continue
            visible.append(line)
        text = "\n".join(visible).strip()
        events: list[dict[str, Any]] = []
        if text:
            events.append({"type": "agent.message", "payload": {"text": text}})
        if usage:
            usage = _normalize_usage(usage)
            events.append({"type": "agent.usage", "payload": dict(usage)})
        return events, usage

    def extract_session_id(self, raw: dict) -> str | None:
        return None


class CodexAdapter(BaseAdapter):
    """OpenAI Codex CLI（openai/codex，Apache-2.0）。

    headless：`codex exec --json "prompt"` → stdout 为 JSONL 事件流
    （thread.started/turn.started/item.started/item.completed/turn.completed/
    turn.failed/error）。usage 权威值在 turn.completed.usage：
    input_tokens / cached_input_tokens（→ cache_read）/ output_tokens /
    reasoning_output_tokens（→ reasoning_tokens）。会话 id 取 thread.started.thread_id
    顶层字段。字段名有版本漂移（item_type→type、assistant_message→agent_message），
    解析兼容两种。权限：默认沙箱只读（plan）；写工作区用 --sandbox workspace-write
    （acceptEdits）；全放行 --dangerously-bypass-approvals-and-sandbox（fullAccess）。
    """
    cli_name = "codex"
    _BIN = ["codex"]
    PERMISSION_FLAGS = {
        "plan": [],  # 默认只读沙箱
        "acceptEdits": ["--sandbox", "workspace-write"],
        "fullAccess": ["--dangerously-bypass-approvals-and-sandbox"],
    }

    def binary(self) -> str | None:
        return shutil.which(self._BIN[0])

    def build_command(self, *, prompt, cwd, model=None, permission_mode="plan",
                      max_turns=8, resume=None) -> list[str]:
        # cwd 由 subprocess 层 cwd= 覆盖（与 claude 同），codex exec 无 --cd 必需
        cmd = [self.binary(), "exec", "--json"]
        cmd += self.PERMISSION_FLAGS.get(permission_mode, self.PERMISSION_FLAGS["plan"])
        if model:
            cmd += ["--model", model]
        if resume:
            # codex resume 子命令：--last 续最近会话；传 thread_id 时按 id 恢复。
            # --json 必须保留（parse_stream 依赖 JSONL），prompt 为续接后新指令
            cmd = [self.binary(), "exec", "resume", "--json"]
            cmd += self.PERMISSION_FLAGS.get(permission_mode, self.PERMISSION_FLAGS["plan"])
            if resume == "last":
                cmd += ["--last"]
            else:
                cmd += [resume]
            if model:
                cmd += ["--model", model]
            cmd.append(prompt)
            return cmd
        cmd.append(prompt)
        return cmd

    def parse_stream(self, lines) -> tuple[list[dict], dict]:
        # codex exec --json 实测格式（v0.44+）：
        # thread.started{thread_id} / turn.started / item.started|completed{item}
        # turn.completed{usage} / turn.failed{error} / error
        events: list[dict] = []
        usage: dict[str, Any] = {}
        thread_id: str | None = None
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(raw, dict):
                continue
            typ = raw.get("type")
            if typ == "thread.started":
                tid = raw.get("thread_id")
                if tid:
                    thread_id = str(tid)
            elif typ in ("item.started", "item.completed", "item.updated"):
                item = raw.get("item") if isinstance(raw.get("item"), dict) else {}
                itype = item.get("type") or item.get("item_type")  # 兼容版本漂移
                if itype in ("assistant_message", "agent_message"):
                    text = item.get("text") or ""
                    events.append({"type": "agent.message",
                                   "payload": {"text": text}})
                elif itype == "command_execution":
                    events.append({"type": "agent.tool_use", "payload": {
                        "name": "bash",
                        "input": {"command": item.get("command", "")},
                        "output": item.get("output", ""),
                    }})
            elif typ == "turn.completed":
                u = raw.get("usage") if isinstance(raw.get("usage"), dict) else {}
                usage = {
                    "input_tokens": _num(u.get("input_tokens")),
                    "output_tokens": _num(u.get("output_tokens")),
                    "cache_creation": 0,
                    "cache_read": _num(u.get("cached_input_tokens")),
                    "reasoning_tokens": _num(u.get("reasoning_output_tokens")),
                    "cost_usd": 0.0,
                }
                events.append({"type": "agent.usage", "payload": dict(usage)})
                events.append({"type": "agent.terminated",
                               "payload": {"stop_reason": "end_turn",
                                           "session_id": thread_id}})
            elif typ == "turn.failed":
                err = raw.get("error") or {}
                events.append({"type": "agent.terminated",
                               "payload": {"stop_reason": "error",
                                           "session_id": thread_id,
                                           "error": str(err)[:500]}})
        usage = _normalize_usage(usage)
        return events, usage

    def extract_session_id(self, raw: dict) -> str | None:
        # thread.started 顶层 thread_id
        tid = raw.get("thread_id") if isinstance(raw, dict) else None
        return str(tid) if tid else None


class KimiAdapter(ClaudeAdapter):
    """Kimi Code CLI（Moonshot，npm @moonshot-ai/kimi-code）。

    headless：`kimi -p <prompt> --output-format stream-json` → JSONL 事件流。
    参数（官方文档）：`-m/--model` 模型、`-S/--session [id]` resume 指定会话、
    `-c/--continue` 续最近会话。`--output-format` 只能与 `-p` 同用。
    注意：`-p` 与 `--yolo/--auto/--plan` 互斥（启动即拒绝）——非交互模式
    默认 auto 权限，permission_mode 不映射 CLI flag（留空，注释说明）。
    stream-json 事件结构仿 claude/grok（assistant/result 行），解析复用
    ClaudeAdapter 实现；字段细节 ⏳ 待实测校准。
    """
    cli_name = "kimi"
    _BIN = ["kimi", str(HOME / ".local/bin/kimi")]
    PERMISSION_FLAGS = {
        # -p 与 --yolo/--auto/--plan 互斥：非交互默认 auto 权限，不追加 flag
        "plan": [],
        "acceptEdits": [],
        "fullAccess": [],
    }

    def build_command(self, *, prompt, cwd, model=None, permission_mode="plan",
                      max_turns=8, resume=None) -> list[str]:
        cmd = [self.binary(), "-p", "--output-format", "stream-json"]
        cmd += self.PERMISSION_FLAGS.get(permission_mode, [])
        if model:
            cmd += ["-m", model]
        if resume:
            # -c 续最近会话；-S <id> 续指定会话（同 PiAdapter 约定）
            cmd += ["-c"] if resume == "last" else ["-S", resume]
        cmd.append(prompt)
        return cmd


class CopilotAdapter(BaseAdapter):
    """GitHub Copilot CLI（github/copilot-cli，新一代 agentic CLI；
    `gh copilot` 已于 2025-10-25 弃用）。

    headless：`copilot -p <PROMPT>`（-p/--prompt 程序化执行，完成后退出，
    退出摘要含 `copilot --resume=SESSION-ID` 续接提示）。`-r/--resume[=VALUE]`
    续会话、`-c/--continue` 续最近会话、`--mode=interactive|plan|autopilot`、
    `--max-ai-credits` 上限。权限走 `--allow all`（等价 COPILOT_ALLOW_ALL=true）。

    parse_stream 为保守文本捕获：可见文本 → agent.message；退出摘要中
    `--resume=<id>` → terminated 回填 session_id（resume 用）。usage 无
    结构化来源（⏳ 待实测：若有 JSONL/usage 输出再精修）。
    """
    cli_name = "copilot"
    _BIN = ["copilot"]
    PERMISSION_FLAGS = {
        "plan": [],
        "acceptEdits": ["--allow", "all"],
        "fullAccess": ["--allow", "all"],
    }

    def binary(self) -> str | None:
        return shutil.which(self._BIN[0])

    def build_command(self, *, prompt, cwd, model=None, permission_mode="plan",
                      max_turns=8, resume=None) -> list[str]:
        # cwd 由 subprocess 层 cwd= 覆盖（copilot 无 --cd，工作目录即信任目录）
        cmd = [self.binary(), "-p", prompt]
        cmd += self.PERMISSION_FLAGS.get(permission_mode, [])
        if resume:
            cmd += ["--resume", resume]
        return cmd

    def parse_stream(self, lines) -> tuple[list[dict], dict]:
        visible: list[str] = []
        session_id: str | None = None
        for line in lines:
            line = line.rstrip("\n")
            # 退出摘要：copilot --resume=SESSION-ID 续接提示（可出现在任意位置）
            m = re.search(r"--resume=(\S+)", line)
            if m and session_id is None:
                session_id = m.group(1)
            stripped = line.strip()
            if not stripped:
                continue
            visible.append(stripped)
        events: list[dict] = []
        text = "\n".join(visible).strip()
        if text:
            events.append({"type": "agent.message", "payload": {"text": text}})
        if session_id:
            events.append({"type": "agent.terminated",
                           "payload": {"session_id": session_id}})
        return events, {}

    def extract_session_id(self, raw: dict) -> str | None:
        return None


class PiAdapter(BaseAdapter):
    """Pi（earendil-works/pi，npm @earendil-works/pi-coding-agent，pi.dev）。

    注意：Pi 与 omp（oh-my-pi）是**两个不同项目**，勿混。
    headless：`pi -p "prompt"` 打印模式；`pi --mode json "prompt"` → stdout
    JSONL 事件流（官方 docs/json.md）。事件：首行 `session{version,id,cwd}`，
    其后 agent_start / turn_start / message_start / message_update
    （assistantMessageEvent.text_delta 增量）/ message_end（权威 message）/
    turn_end / agent_end。会话 id 取首行 session.id；续接 `pi -c`（最近）或
    `pi --session <path|id>`。模型/权限 flag 文档未明确（⏳ 待实测），
    parse_stream 保守：message_end 文本 → agent.message，agent_end → terminated；
    usage 无结构化来源（⏳）。
    """
    cli_name = "pi"
    _BIN = ["pi", str(HOME / ".local/bin/pi")]

    def binary(self) -> str | None:
        for cand in self._BIN:
            found = shutil.which(cand)
            if found:
                return found
        return None

    def build_command(self, *, prompt, cwd, model=None, permission_mode="plan",
                      max_turns=8, resume=None) -> list[str]:
        # --mode json 输出全部事件；resume: -c 续最近，--session <id> 指定
        cmd = [self.binary(), "--mode", "json"]
        if resume:
            cmd += ["--session", resume] if resume != "last" else ["-c"]
        cmd.append(prompt)
        return cmd

    def parse_stream(self, lines) -> tuple[list[dict], dict]:
        events: list[dict] = []
        session_id: str | None = None
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(raw, dict):
                continue
            typ = raw.get("type")
            if typ == "session" and raw.get("id"):
                session_id = str(raw["id"])
            elif typ == "message_end" and isinstance(raw.get("message"), dict):
                text = _extract_text(raw["message"].get("content"))
                if text:
                    events.append({"type": "agent.message",
                                   "payload": {"text": text}})
            elif typ == "agent_end":
                events.append({"type": "agent.terminated",
                               "payload": {"stop_reason": "end_turn",
                                           "session_id": session_id}})
        return events, {}

    def extract_session_id(self, raw: dict) -> str | None:
        sid = raw.get("id") if isinstance(raw, dict) else None
        return str(sid) if sid else None


class ZcodeAdapter(BaseAdapter):
    """ZCode（Z.ai 智谱，github.com/zhipuai/zcode）。

    headless 路径 ⏳ 待实测：官方 CLI 存在 `--prompt`，但社区集成尝试发现
    其依赖私有配置 schema，GUI 实际走 app-server 协议（session/create +
    state.updated patch 流），CLI 直连有 401 认证障碍。本适配器先保守：
    `zcode --prompt <prompt>` + 文本捕获兜底（可见文本 → agent.message），
    待真实输出后按文档精修。
    """
    cli_name = "zcode"
    _BIN = ["zcode"]

    def binary(self) -> str | None:
        return shutil.which(self._BIN[0])

    def build_command(self, *, prompt, cwd, model=None, permission_mode="plan",
                      max_turns=8, resume=None) -> list[str]:
        cmd = [self.binary(), "--prompt"]
        if model:
            cmd += ["--model", model]
        if resume:
            cmd += ["--session", resume]
        cmd.append(prompt)
        return cmd

    def parse_stream(self, lines) -> tuple[list[dict], dict]:
        visible: list[str] = []
        for line in lines:
            line = line.rstrip("\n")
            stripped = line.strip()
            if not stripped:
                continue
            visible.append(stripped)
        events: list[dict] = []
        text = "\n".join(visible).strip()
        if text:
            events.append({"type": "agent.message", "payload": {"text": text}})
        return events, {}

    def extract_session_id(self, raw: dict) -> str | None:
        return None


class ClineAdapter(BaseAdapter):
    """Cline（cline/cline，VS Code 内模型无关 agent；Apache-2.0）。

    ⚠️ Cline 主要为 VS Code 扩展（IDE 绑定），独立 CLI headless 模式不明确
    （⏳ 待实测确认二进制与参数）。本适配器保守：`cline --prompt <prompt>`
    + 文本捕获兜底；若不存在独立 CLI 二进制，spawn 会报
    "CLI cline was not found"（不会误跑 IDE 内实例）。
    """
    cli_name = "cline"
    _BIN = ["cline"]

    def binary(self) -> str | None:
        return shutil.which(self._BIN[0])

    def build_command(self, *, prompt, cwd, model=None, permission_mode="plan",
                      max_turns=8, resume=None) -> list[str]:
        cmd = [self.binary(), "--prompt"]
        if model:
            cmd += ["--model", model]
        if resume:
            cmd += ["--resume", resume]
        cmd.append(prompt)
        return cmd

    def parse_stream(self, lines) -> tuple[list[dict], dict]:
        visible: list[str] = []
        for line in lines:
            line = line.rstrip("\n")
            stripped = line.strip()
            if not stripped:
                continue
            visible.append(stripped)
        events: list[dict] = []
        text = "\n".join(visible).strip()
        if text:
            events.append({"type": "agent.message", "payload": {"text": text}})
        return events, {}

    def extract_session_id(self, raw: dict) -> str | None:
        return None


def _num(v):
    """usage 字段数值防护：非 int/float（None/字符串/布尔）一律按 0。"""
    return v if isinstance(v, (int, float)) else 0


def _extract_text(content) -> str:
    """content 为字符串或内容块数组（Anthropic Messages 风格）时提取可见文本。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(b.get("text", "") for b in content
                       if isinstance(b, dict) and b.get("type") == "text")
    return ""


def _assistant_event(events, usage, seen_ids, msg) -> dict:
    """claude/grok 共享的 assistant 行处理：按 message.id 去重累加 usage，
    追加 agent.message（content 统一走 _extract_text）。返回更新后的 usage。"""
    mid = msg.get("id")
    if mid and mid not in seen_ids:
        seen_ids.add(mid)
        if isinstance(msg.get("usage"), dict):
            u = msg["usage"]
            usage = _merge_usage(usage, {
                "input_tokens": _num(u.get("input_tokens")),
                "output_tokens": _num(u.get("output_tokens")),
                "cache_creation": _num(u.get("cache_creation_input_tokens")),
                "cache_read": _num(u.get("cache_read_input_tokens")),
                "cost_usd": 0.0,
            })
    events.append({"type": "agent.message",
                   "payload": {"text": _extract_text(msg.get("content"))}})
    return usage


def _merge_usage(base: dict, add: dict) -> dict:
    """累加所有 usage 字段（含 cache_creation/cache_read/cost_usd）。
    各 adapter 私有解析不动，归一化由 _normalize_usage 在返回前统一字段名。"""
    out = dict(base)
    for k, v in add.items():
        out[k] = out.get(k, 0) + _num(v)
    return out


def _normalize_usage(raw: dict) -> dict:
    """归一化各 adapter 私有 usage 字段名到统一 5 元组：
    {input_tokens, output_tokens, cache_creation, cache_read, cost_usd}。
    额外保留 reasoning_tokens（omp/grok 有，claude 无）——下游可选用，不丢数据。
    空输入保持 {}（畸形/无用量行不产生伪 0 元组，与既有语义一致）。

    各 adapter 私有解析不动，只在此层做字段名映射 + AtomCode cached 漏算修正
    （cached 应计入 cache_read 并加进 input_tokens，原实现只塞 cache_read 不算 input）。
    """
    if not raw:
        return {}
    out = {
        "input_tokens": _num(raw.get("input_tokens")),
        "output_tokens": _num(raw.get("output_tokens")),
        "cache_creation": _num(raw.get("cache_creation")),
        "cache_read": _num(raw.get("cache_read")),
        "cost_usd": float(raw.get("cost_usd") or 0),
    }
    # reasoning_tokens 透传（omp camelCase、opencode reasoning、grok/claude 无此字段）
    rt = raw.get("reasoning_tokens")
    if rt is not None:
        out["reasoning_tokens"] = _num(rt)
    elif raw.get("reasoningTokens") is not None:
        out["reasoning_tokens"] = _num(raw.get("reasoningTokens"))
    elif raw.get("reasoning") is not None:
        out["reasoning_tokens"] = _num(raw.get("reasoning"))
    # omp camelCase 兜底
    for src, dst in (("cacheRead", "cache_read"), ("cacheWrite", "cache_creation")):
        if raw.get(src) is not None:
            out[dst] = _num(raw.get(src))
    return out


_CLAUDE = ClaudeAdapter()
_GROK = GrokAdapter()
_OPENCODE = OpencodeAdapter()
_OMP = OmpAdapter()
_ATOMCODE = AtomCodeAdapter()
_CODEX = CodexAdapter()
_KIMI = KimiAdapter()
_COPILOT = CopilotAdapter()
_PI = PiAdapter()
_ZCODE = ZcodeAdapter()
_CLINE = ClineAdapter()
_ADAPTERS: dict[str, BaseAdapter] = {
    "claude": _CLAUDE,
    "grok": _GROK,
    "opencode": _OPENCODE,
    "omp": _OMP,
    "atomcode": _ATOMCODE,
    "codex": _CODEX,
    "kimi": _KIMI,
    "copilot": _COPILOT,
    "pi": _PI,
    "zcode": _ZCODE,
    "cline": _CLINE,
}


def get_adapter(name: str) -> BaseAdapter:
    if name not in _ADAPTERS:
        raise ValueError(f"unknown target_cli: {name}")
    return _ADAPTERS[name]


def register_adapter(adapter: BaseAdapter) -> None:
    _ADAPTERS[adapter.cli_name] = adapter


def adapter_names() -> list[str]:
    """已注册适配器名（内置 + 自定义），供 MCP 层 target_cli enum 动态化。"""
    return sorted(_ADAPTERS)


def _get_path(obj: Any, dotted: str) -> Any:
    """按点路径取值（'message.content' → obj['message']['content']）；缺失返回 None。"""
    cur = obj
    for part in (dotted.split(".") if dotted else []):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


class GenericAdapter(BaseAdapter):
    """配置驱动的通用适配器：用户为新 CLI 写一份 JSON 配置即可接入，无需改代码。

    配置放 <state_dir>/custom-clis/*.json（state_dir 默认 ~/.codex/agent-mcp），
    daemon 与 MCP 薄层启动时自动加载注册；模板与字段说明见 docs/custom-cli.md。

    配置结构：
    {
      "cli_name": "mycli",                        # 必填：target_cli 使用的名字
      "bins": ["mycli", "~/.local/bin/mycli"],    # 二进制探测顺序（可省，默认 [cli_name]）
      "first_start_seconds": 10,                  # 可选：min_expected_seconds（默认 10）
      "command": {
        "prefix": ["-p", "--output-format", "stream-json"],   # 固定前置参数（{cwd} 占位可替换）
        "permission_flags": {                     # 可选：按 permission_mode 追加
          "plan": ["--permission-mode", "plan"],
          "acceptEdits": ["--permission-mode", "acceptEdits"],
          "fullAccess": ["--dangerously-skip-permissions"]
        },
        "model_flag": ["--model", "{value}"],     # 可选：传 model 时追加（{value} 占位）
        "resume_flag": ["--resume", "{value}"]    # 可选：传 resume 时追加（{value} 占位）
      },                                           # prompt 始终追加在命令末尾
      "parse": {
        "mode": "jsonl",                          # jsonl（默认）| text
        "event_field": "type",                    # jsonl：事件类型字段名
        "message_types": ["assistant"],           # jsonl：视为消息的事件类型
        "message_text_path": "message.content",   # jsonl：消息文本点路径（content 可为块数组）
        "result_types": ["result"],               # jsonl：视为终局 usage 的事件类型
        "usage_path": "usage",                    # jsonl：usage 对象点路径
        "cost_path": "total_cost_usd",            # jsonl：成本字段点路径（可省，缺省 0）
        "session_id_path": "session_id",          # jsonl：会话 id 点路径（可省）
        "stop_reason_path": "stop_reason",        # jsonl：终止原因点路径（缺省 end_turn）
        "skip_prefixes": ["[tokens]", "[done]"],  # text：跳过的前缀行
        "usage_regex": ""                         # text：可选 named-group 正则提取 usage
      }
    }
    """

    def __init__(self, config: dict[str, Any]):
        self._cfg = config
        self.cli_name = str(config.get("cli_name") or "")
        if not self.cli_name:
            raise ValueError("custom CLI config missing cli_name")
        self._bins = [str(b) for b in config.get("bins") or [self.cli_name]]
        self._cmd = config.get("command") or {}
        self._parse = config.get("parse") or {}
        self.first_start_seconds = float(config.get("first_start_seconds") or 10)
        # B2：usage 结算语义可在配置中声明（缺省 authoritative）
        semantics = str(config.get("usage_semantics") or "authoritative")
        if semantics not in ("authoritative", "cumulative"):
            raise ValueError(
                f"custom CLI {self.cli_name}: usage_semantics must be "
                f"'authoritative' or 'cumulative', got {semantics!r}")
        self.usage_semantics = semantics

    def binary(self) -> str | None:
        for cand in self._bins:
            found = shutil.which(cand)
            if found:
                return found
        return None

    def _flag(self, key: str, value: str | None) -> list[str]:
        if value is None:
            return []
        spec = self._cmd.get(key)
        if not spec:
            return []
        return [str(x).replace("{value}", value) for x in spec]

    def build_command(self, *, prompt: str, cwd: str, model: str | None,
                      permission_mode: str, max_turns: int,
                      resume: str | None) -> list[str]:
        cmd = [self.binary()]
        prefix = self._cmd.get("prefix") or []
        cmd += [str(x).replace("{cwd}", str(cwd)) for x in prefix]
        perm = (self._cmd.get("permission_flags") or {}).get(permission_mode)
        if perm:
            cmd += [str(x) for x in perm]
        cmd += self._flag("model_flag", model)
        cmd += self._flag("resume_flag", resume)
        cmd.append(prompt)
        return cmd

    def parse_stream(self, lines: list[str]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        if self._parse.get("mode") == "text":
            return self._parse_text(lines)
        return self._parse_jsonl(lines)

    def _parse_jsonl(self, lines) -> tuple[list[dict], dict]:
        events: list[dict] = []
        usage: dict[str, Any] = {}
        ev_field = self._parse.get("event_field", "type")
        msg_types = set(self._parse.get("message_types") or ["assistant"])
        result_types = set(self._parse.get("result_types") or ["result"])
        text_path = self._parse.get("message_text_path", "message.content")
        usage_path = self._parse.get("usage_path", "usage")
        cost_path = self._parse.get("cost_path", "total_cost_usd")
        sid_path = self._parse.get("session_id_path", "session_id")
        stop_path = self._parse.get("stop_reason_path", "stop_reason")
        umap = self._parse.get("usage_field_map") or {
            "input_tokens": "input_tokens",
            "output_tokens": "output_tokens",
            "cache_creation": "cache_creation",
            "cache_read": "cache_read",
            "cost_usd": "cost_usd",
        }
        session_id: str | None = None
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(raw, dict):
                continue
            sid = _get_path(raw, sid_path)
            if sid:
                session_id = str(sid)
            typ = raw.get(ev_field)
            if typ in msg_types:
                text = _get_path(raw, text_path)
                events.append({"type": "agent.message",
                               "payload": {"text": _extract_text(text)}})
            elif typ in result_types:
                u = _get_path(raw, usage_path)
                if isinstance(u, dict):
                    usage = {k: _num(u.get(v)) for k, v in umap.items()}
                cost = _get_path(raw, cost_path)
                if isinstance(cost, (int, float)):
                    usage["cost_usd"] = cost
                events.append({"type": "agent.usage", "payload": dict(usage)})
                stop = _get_path(raw, stop_path) or "end_turn"
                events.append({"type": "agent.terminated",
                               "payload": {"stop_reason": str(stop),
                                           "session_id": session_id}})
        usage = _normalize_usage(usage)
        return events, usage

    def _parse_text(self, lines) -> tuple[list[dict], dict]:
        visible: list[str] = []
        usage: dict[str, Any] = {}
        skip = tuple(self._parse.get("skip_prefixes") or [])
        rx = self._parse.get("usage_regex") or ""
        for line in lines:
            line = line.rstrip("\n")
            if rx:
                m = re.search(rx, line)
                if m:
                    parsed: dict[str, Any] = {}
                    for k, v in m.groupdict().items():
                        if not v:
                            continue
                        try:
                            parsed[k] = int(v)
                        except ValueError:
                            try:
                                parsed[k] = float(v)
                            except ValueError:
                                pass  # 非数字捕获跳过该字段，不中断整段解析
                    if parsed:
                        usage = parsed
                    continue
            if skip and line.lstrip().startswith(skip):
                continue
            visible.append(line)
        text = "\n".join(visible).strip()
        events: list[dict] = []
        if text:
            events.append({"type": "agent.message", "payload": {"text": text}})
        if usage:
            usage = _normalize_usage(usage)
            events.append({"type": "agent.usage", "payload": dict(usage)})
        return events, usage

    def extract_session_id(self, raw: dict) -> str | None:
        sid = _get_path(raw, self._parse.get("session_id_path", "session_id"))
        return str(sid) if sid else None


def load_custom_adapters(state_dir: Path | str) -> list[str]:
    """扫描 <state_dir>/custom-clis/*.json 注册 GenericAdapter，返回注册的 cli 名列表。

    单文件失败仅 stderr 告警不中断（坏配置不该拖垮整个 daemon 启动）。
    """
    custom_dir = Path(state_dir) / "custom-clis"
    loaded: list[str] = []
    if not custom_dir.is_dir():
        return loaded
    for path in sorted(custom_dir.glob("*.json")):
        try:
            cfg = json.loads(path.read_text(encoding="utf-8"))
            register_adapter(GenericAdapter(cfg))
            loaded.append(str(cfg.get("cli_name")))
            print(f"[cli_adapters] registered custom CLI adapter: {cfg.get('cli_name')} <- {path}",
                  file=sys.stderr)
        except Exception as exc:
            print(f"[cli_adapters] failed to load custom CLI {path}: {exc}",
                  file=sys.stderr)
    return loaded
