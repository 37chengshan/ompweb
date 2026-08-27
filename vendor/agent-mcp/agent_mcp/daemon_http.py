from __future__ import annotations
import hashlib
import hmac
import json
import os
import subprocess
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ALLOWED_HOSTS = {"127.0.0.1", "localhost"}
MAX_SSE_CLIENTS = 128
MAX_SSE_BUFFER = 1000  # 每客户端缓冲事件上限（L6：防慢消费者内存增长）
MAX_JSON_BYTES = 1_000_000
HEARTBEAT_SECONDS = 15.0
SNAPSHOT_EVENTS_PER_AGENT = 60
_API_METHODS = {
    "/api/agents/spawn": "spawn",
    "/api/agents/send_message": "send_message",
    "/api/agents/steer": "steer",
    "/api/agents/followup": "followup",
    "/api/agents/wait": "wait",
    "/api/agents/interrupt": "interrupt",
    "/api/agents/list": "list_agents",
    "/api/agents/activity": "activity",
    "/api/usage": "usage",
    "/api/memory/store": "memory_store",
    "/api/memory/recall": "memory_recall",
    "/api/mailbox/send": "mailbox_send",
    "/api/mailbox/fetch": "mailbox_fetch",
    "/api/consensus/vote": "consensus_vote",
    "/api/policies/list": "policy_list",
    "/api/policies/add": "policy_add",
    "/api/policies/state": "policy_state",
}
# 需要 token 的 workspace 写操作（merge/discard 会执行 git 命令）
_WORKSPACE_POST = {"/api/workspaces/merge": "merged",
                   "/api/workspaces/discard": "discarded"}
_WORKSPACES_FILE = "workspaces.json"
_POLICIES_FILE = "policies.json"


def _state_dir_of(server: "DaemonHTTPServer") -> Path | None:
    """从 dispatcher 取 state_dir（无 dispatcher 时 None）。"""
    dispatcher = getattr(server, "dispatcher", None)
    if dispatcher is None:
        return None
    return getattr(dispatcher, "state_dir", None)


def _read_json_file(path: Path | None) -> dict[str, Any] | None:
    if path is None or not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _policies_state_payload(server: "DaemonHTTPServer") -> dict[str, Any]:
    """策略面板聚合：优先 dispatcher（daemon 内引擎唯一数据源，H1/H5 修复）；
    无 dispatcher 时回退文件 + env。"""
    dispatcher = getattr(server, "dispatcher", None)
    if dispatcher is not None:
        try:
            return dispatcher.policy_state({})
        except Exception:
            pass  # 回退到文件聚合
    state_dir = _state_dir_of(server)
    file_state = _read_json_file(state_dir / _POLICIES_FILE if state_dir else None) or {}
    try:
        limit_usd = float(os.environ.get("AGENT_MCP_BUDGET_USD", "10.0"))
    except ValueError:
        limit_usd = 10.0
    return {
        "limit_usd": limit_usd,
        "spent_usd": 0.0,
        "spawns": 0,
        "policies": file_state.get("policies") or [],
        "log": file_state.get("log") or [],
        "policy_configs": {},
    }


def _workspaces_payload(server: "DaemonHTTPServer") -> dict[str, Any]:
    state_dir = _state_dir_of(server)
    file_state = _read_json_file(state_dir / _WORKSPACES_FILE if state_dir else None) or {}
    workspaces = file_state.get("workspaces") or []
    return {"workspaces": workspaces}


def _workspace_apply(server: "DaemonHTTPServer", body: dict[str, Any],
                     action: str) -> dict[str, Any]:
    """merge：git merge <branch>（在 base 工作区）+ worktree remove + branch -d。
    discard：worktree remove --force + branch -D。更新 workspaces.json 状态。"""
    ws_id = str(body.get("id") or "")
    if not ws_id:
        raise ValueError("id 必填")
    state_dir = _state_dir_of(server)
    if state_dir is None:
        raise RuntimeError("state_dir 不可用")
    ws_file = state_dir / _WORKSPACES_FILE
    file_state = _read_json_file(ws_file) or {}
    workspaces = file_state.get("workspaces") or []
    target = next((w for w in workspaces if str(w.get("id")) == ws_id), None)
    if target is None:
        raise ValueError(f"workspace 不存在: {ws_id}")
    path = target.get("path") or ""
    base_dir = target.get("base_dir") or ""
    branch = target.get("branch") or f"agent-{ws_id}"
    if not path:
        raise ValueError("workspace 缺少 path")
    # 路径归属校验（L5）：path 必须位于 base_dir 下，且 base_dir 存在
    if base_dir:
        base_resolved = Path(base_dir).resolve()
        path_resolved = Path(path).resolve()
        if base_resolved not in path_resolved.parents:
            raise ValueError("workspace path 不在 base_dir 内，拒绝操作")
    try:
        if action == "merged":
            if not base_dir or not Path(base_dir).is_dir():
                raise ValueError("merge 需要有效的 base_dir（git 仓库根）")
            # 真合并：在 base 工作区 merge 分支（容忍空提交：--allow-unrelated-histories）
            proc = subprocess.run(["git", "-C", base_dir, "merge", "--no-edit",
                                   "--allow-unrelated-histories", branch],
                                  capture_output=True, text=True, timeout=120)
            if proc.returncode != 0:
                raise RuntimeError(f"git merge 失败: {proc.stderr[:300] or proc.stdout[:300]}")
            # 合并成功 → 删除 worktree 与分支
            subprocess.run(["git", "-C", base_dir, "worktree", "remove", "--force", path],
                           capture_output=True, text=True, timeout=60)
            subprocess.run(["git", "-C", base_dir, "branch", "-d", branch],
                           capture_output=True, text=True, timeout=60)
        else:  # discard
            subprocess.run(["git", "-C", base_dir, "worktree", "remove", "--force", path],
                           capture_output=True, text=True, timeout=60)
            subprocess.run(["git", "-C", base_dir, "branch", "-D", branch],
                           capture_output=True, text=True, timeout=60)
    except FileNotFoundError:
        raise RuntimeError("git 不可用")
    target["status"] = action
    file_state["workspaces"] = workspaces
    tmp = ws_file.with_suffix(".tmp")
    tmp.write_text(json.dumps(file_state, ensure_ascii=False,
                              separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, ws_file)
    # M2：发布 workspace_status SSE 事件（面板实时更新徽章）
    server.broadcaster.publish({"type": "workspace_status",
                                "agent_id": ws_id,
                                "payload": {"id": ws_id, "status": action}},
                               seq=None)
    return {"status": action, "id": ws_id}


class EventBroadcaster:
    """SSE 统一广播：事件循环单写，非阻塞写，写失败断开，统一心跳。"""
    def __init__(self, max_clients: int = MAX_SSE_CLIENTS):
        self.max = max_clients
        self._clients: dict[int, dict[str, Any]] = {}
        self._next = 0
        self._lock = threading.Lock()

    def connect(self) -> dict[str, Any] | None:
        with self._lock:
            if len(self._clients) >= self.max:
                return None
            self._next += 1
            client = {"id": self._next, "buffer": [], "closed": False,
                      "replayed": set()}  # 回放阶段已下发的 seq，live 阶段据此去重
            self._clients[self._next] = client
            return client

    def close(self, client: dict[str, Any]) -> None:
        with self._lock:
            client["closed"] = True
            self._clients.pop(client["id"], None)

    def publish(self, event: dict[str, Any], *, seq: int | None) -> None:
        # seq=None 的事件（agent.message_delta）不落库，SSE 不带 id，
        # 断线回放只对齐落库 seq，不会与其冲突
        id_line = f"id: {seq}\n" if seq is not None else ""
        payload = (f"{id_line}event: {event['type']}\n"
                   f"data: {json.dumps(event, ensure_ascii=False)}\n\n")
        with self._lock:
            clients = list(self._clients.values())
        for client in clients:
            if not client["closed"]:
                # L6：客户端缓冲上限，防慢消费者无限增长（丢弃最旧）
                client["buffer"].append(payload)
                if len(client["buffer"]) > MAX_SSE_BUFFER:
                    del client["buffer"][: len(client["buffer"]) - MAX_SSE_BUFFER]

    def drain(self, client: dict[str, Any]) -> str | None:
        """取出并清空缓冲（与 publish/heartbeat 同锁，避免 join 期间丢事件）。"""
        with self._lock:
            if not client["buffer"]:
                return None
            chunk = "".join(client["buffer"])
            del client["buffer"][:]
            return chunk

    def heartbeat_all(self) -> None:
        with self._lock:
            clients = list(self._clients.values())
        for client in clients:
            if not client["closed"]:
                client["buffer"].append(": ping\n\n")


class DaemonHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, addr, web_root: Path, *, token: str, db: Any,
                 dispatcher: Any, broadcaster: EventBroadcaster | None = None):
        self.web_root = Path(web_root)
        self.token = token
        self.db = db
        self.dispatcher = dispatcher
        self.broadcaster = broadcaster or EventBroadcaster()
        super().__init__(addr, Handler)
        self.server_name = "agent-mcp-daemon"


class Handler(BaseHTTPRequestHandler):
    server: DaemonHTTPServer  # type: ignore[assignment]

    def log_message(self, fmt, *args):  # 静默访问日志
        pass

    def _check_host(self) -> bool:
        host = (self.headers.get("Host") or "").split(":")[0]
        if host in ALLOWED_HOSTS:
            return True
        self.send_error(400, "bad host")
        return False

    def _supplied_token(self) -> str:
        """A6: 令牌提取——优先 X-Auth-Token 头；GET/SSE 无法自定义 header，
        回退 URL ?token= 查询参数（与前端 #token= hash 通道同源的明文通道，
        仅用于回环监控页）。"""
        supplied = self.headers.get("X-Auth-Token") or ""
        if supplied:
            return supplied
        if "?" in self.path:
            query = urllib.parse.parse_qs(self.path.split("?", 1)[1])
            values = query.get("token") or []
            if values:
                return str(values[0])
        return ""

    def _has_valid_token(self) -> bool:
        return hmac.compare_digest(self._supplied_token(), self.server.token)

    def _check_token(self) -> bool:
        if self._has_valid_token():
            return True
        self.send_error(401, "unauthorized")
        return False

    def do_GET(self):
        if not self._check_host():
            return
        path = self.path.split("?")[0]
        if path == "/health":
            self._send_json(200, {
                "ok": True,
                "version": 1,
                "service": "agent-mcp-daemon",
                "token_sha256": hashlib.sha256(self.server.token.encode("utf-8")).hexdigest(),
            })
        elif path == "/api/config":
            self._send_json(200, {"max_message_chars": 20_000,
                                  "write_auth": "url-fragment"})
        elif path == "/api/snapshot":
            # A6：读端点纳入鉴权（header 或 ?token= 均可）
            if not self._check_token():
                return
            self._send_snapshot()
        elif path == "/api/policies/state":
            if not self._check_token():
                return
            self._send_json(200, _policies_state_payload(self.server))
        elif path == "/api/workspaces":
            if not self._check_token():
                return
            self._send_json(200, _workspaces_payload(self.server))
        elif path == "/api/agents/list":
            # 协作泳道数据源：GET 形式（MCP 薄层仍走 POST /api/agents/list）
            if not self._check_token():
                return
            if self.server.dispatcher is None:
                self._send_json(503, {"error": "dispatcher not ready"})
                return
            self._send_json(200, self.server.dispatcher.list_agents({}))
        elif path == "/api/agents/activity":
            # 协作泳道活动流：无 agent_id → 按全部会话聚合（与 POST 同语义）
            if not self._check_token():
                return
            if self.server.dispatcher is None:
                self._send_json(503, {"error": "dispatcher not ready"})
                return
            self._send_json(200, self.server.dispatcher.activity({}))
        elif path == "/api/usage/series":
            # 趋势图数据源：按小时 token/成本聚合（token 保护）
            if not self._check_token():
                return
            db = getattr(self.server, "db", None)
            if db is None:
                self._send_json(503, {"error": "db not ready"})
                return
            query = urllib.parse.parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
            try:
                hours = int((query.get("hours") or ["24"])[0])
            except ValueError:
                hours = 24
            self._send_json(200, {"series": db.usage_series(hours)})
        elif path == "/events":
            # A6：SSE 纳入鉴权（EventSource 走 ?token= 查询通道）
            if not self._check_token():
                return
            self._stream_events()
        elif path == "/api/events":
            # message 通道版：新面板消费（data 内嵌 type，无 event: 行）
            if not self._check_token():
                return
            self._stream_events(message_mode=True)
        elif path == "/" or path == "/index.html":
            self._send_index()
        elif path.startswith("/panels/"):
            self._send_file("panels/" + path[len("/panels/"):])
        elif path.startswith("/css/"):
            self._send_file("css/" + path[len("/css/"):])
        elif path.startswith("/static/"):
            self._send_file(path[len("/static/"):])
        else:
            self.send_error(404)

    def do_POST(self):
        if not self._check_host():
            return
        if not self._check_token():
            return
        path = self.path.split("?")[0]
        action = _WORKSPACE_POST.get(path)
        if action is not None:
            # workspace merge/discard：独立处理（不走 dispatcher 方法表）
            body = self._read_json()
            try:
                result = _workspace_apply(self.server, body, action)
            except (ValueError, RuntimeError) as exc:
                self._send_json(400, {"error": str(exc)})
                return
            self._send_json(200, result)
            return
        method = _API_METHODS.get(path)
        if method is None:
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._send_json(400, {"error": "invalid Content-Length"})
            return
        if length > MAX_JSON_BYTES:
            # 排空请求体后再回 413：避免客户端写入尚未完成时连接被断（BrokenPipe）
            self.rfile.read(min(length, MAX_JSON_BYTES * 2))
            self._send_json(413, {"error": f"request body exceeds {MAX_JSON_BYTES} bytes"})
            return
        if self.server.dispatcher is None:
            self._send_json(503, {"error": "dispatcher not ready"})
            return
        body = self._read_json()
        try:
            result = getattr(self.server.dispatcher, method)(body)
        except ValueError as exc:
            self._send_json(400, {"error": str(exc)})
            return
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})
            return
        self._send_json(200, result)

    def _send_snapshot(self):
        """只读历史快照（网页刷新重建导图用）：无 token，Host 校验照旧。"""
        query = (urllib.parse.parse_qs(self.path.split("?", 1)[1])
                 if "?" in self.path else {})
        session_id = query.get("session_id", [None])[0]
        db = self.server.db
        if db is None:
            self._send_json(503, {"error": "db not ready"})
            return
        agents = db.agents_by_session(session_id)
        if session_id is not None and not agents:
            self._send_json(400, {"error": f"session {session_id} not found"})
            return
        # 每个 agent 取最近 N 条事件（而非全局前 500 条）：避免后 spawn 的 agent
        # 事件被整体截断，导致详情面板（当前工具/消息流/最近事件）空白。
        events = db.events_by_agents([a["id"] for a in agents],
                                     per_agent_limit=SNAPSHOT_EVENTS_PER_AGENT)
        # D1: gantt 字段——created_at 原样返；finished_at 缺失（running 态）用 updated_at 兜底 null。
        # D2: anomalies 预计算（daemon 侧聚合，免前端扫全事件流）。
        keep = ("id", "parent_id", "task_name", "cli", "model",
                "status", "stop_reason", "updated_at", "created_at",
                "finished_at", "session_id")
        totals = {"input_tokens": 0, "output_tokens": 0, "cache_creation": 0,
                  "cache_read": 0, "cost_usd": 0.0}
        per_agent = []
        agent_out = []
        for a in agents:
            u = db.usage_total(a["id"])
            per_agent.append({"agent_id": a["id"], **u})
            for k in totals:
                totals[k] = totals.get(k, 0) + u.get(k, 0)
            row = {k: a.get(k) for k in keep}
            # D1 兜底：running 态无 finished_at，用 updated_at null 化（前端 Gantt pulsing 判 running）
            if row.get("finished_at") is None and row.get("status") == "running":
                row["finished_at"] = None
            # D2 预计算异常 badge（免前端再扫全事件流）
            row["anomalies"] = db.agent_anomalies(a["id"])
            agent_out.append(row)
        self._send_json(200, {
            "agents": agent_out,
            "events": events,
            "usage": {"totals": totals, "per_agent": per_agent},
            "last_seq": events[-1]["seq"] if events else 0,
        })

    def _stream_events(self, message_mode: bool = False):
        """SSE 直播流。last_seq 查询参数 / Last-Event-ID 头 → 先回放 SQLite 事件，再进入 live。

        message_mode=False：命名事件流（event: <type> 行），index.html 消费（/events）。
        message_mode=True：message 通道流（data 内嵌 type，无 event: 行），新面板消费（/api/events）。

        顺序：先 connect 再回放——connect 之后 publish 的事件都进本客户端缓冲；
        回放以连接时刻的 max_seq 为固定上界分页补发 (last_seq, boundary]，
        已回放的 seq 记入 replayed，live 阶段按该集合去重，保证不重、不丢、顺序严格，
        且回放不会无限追逐回放期间新写入的事件（boundary 之外的事件走 live 缓冲）。
        """
        query = (urllib.parse.parse_qs(self.path.split("?", 1)[1])
                 if "?" in self.path else {})
        try:
            last_seq = int((query.get("last_seq") or ["0"])[0])
        except ValueError:
            last_seq = 0
        try:
            last_seq = max(last_seq, int(self.headers.get("Last-Event-ID") or "0"))
        except ValueError:
            pass
        client = self.server.broadcaster.connect()
        if client is None:
            self.send_error(503, "too many SSE clients")
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            if last_seq > 0 and self.server.db is not None:
                boundary = self.server.db.max_seq()
                cursor = last_seq
                while cursor < boundary:
                    page = self.server.db.events_since(cursor, limit=1000)
                    if not page:
                        break
                    reached_boundary = False
                    for ev in page:
                        seq = ev.get("seq")
                        if seq is None:
                            continue
                        if seq > boundary:
                            reached_boundary = True
                            break
                        event_payload = {
                            "type": ev["type"],
                            "agent_id": ev["agent_id"],
                            "payload": ev["payload"],
                            "seq": seq,
                        }
                        payload = self._frame(event_payload, seq, message_mode)
                        try:
                            self.wfile.write(payload.encode("utf-8"))
                            self.wfile.flush()
                        except (BrokenPipeError, OSError):
                            return
                        client["replayed"].add(seq)
                        cursor = seq
                    if reached_boundary or len(page) < 1000:
                        break
            while not client["closed"]:
                chunk = self.server.broadcaster.drain(client)
                if chunk:
                    if client["replayed"]:
                        chunk = self._strip_replayed(chunk, client["replayed"])
                    if message_mode and chunk:
                        chunk = self._to_message_chunk(chunk)
                    if chunk:
                        try:
                            self.wfile.write(chunk.encode("utf-8"))
                            self.wfile.flush()
                        except (BrokenPipeError, OSError):
                            break
                else:
                    time.sleep(0.1)
        finally:
            self.server.broadcaster.close(client)

    @staticmethod
    def _frame(event_payload: dict[str, Any], seq: int,
               message_mode: bool) -> str:
        """组 SSE 帧。message_mode：id: + data 内嵌 type（无 event: 行，供
        Last-Event-ID 重连续传）；否则命名事件帧（id: + event: + data:）。"""
        data = json.dumps(event_payload, ensure_ascii=False)
        if message_mode:
            return f"id: {seq}\ndata: {data}\n\n"
        return f"id: {seq}\nevent: {event_payload['type']}\ndata: {data}\n\n"

    @staticmethod
    def _to_message_chunk(chunk: str) -> str:
        """命名事件帧块 → message 通道帧块（剥 event: 行，保留 id:/data: 行；
        data 已内嵌 type，前端按 data.type 处理；id 供 Last-Event-ID 重连）。"""
        out: list[str] = []
        for part in chunk.split("\n\n"):
            if not part:
                continue
            lines = [ln for ln in part.split("\n")
                     if not ln.startswith("event: ")]
            if lines:
                out.append("\n".join(lines))
        return ("\n\n".join(out) + "\n\n") if out else ""

    @staticmethod
    def _strip_replayed(chunk: str, replayed: set[int]) -> str:
        """去掉 live 缓冲中已由回放阶段下发的 SSE 事件（按 id: seq 匹配），避免重复。"""
        if not replayed:
            return chunk
        keep = []
        for part in chunk.split("\n\n"):
            if not part:
                continue
            first = part.split("\n", 1)[0]
            if first.startswith("id: "):
                try:
                    if int(first[4:]) in replayed:
                        continue
                except ValueError:
                    pass
            keep.append(part)
        return ("\n\n".join(keep) + "\n\n") if keep else ""

    def _security_headers(self) -> None:
        self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")

    def _send_json(self, code: int, payload: Any):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._security_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_index(self):
        """发送 index.html 并注入面板 loader（幂等：已有注入标记则跳过）。

        A6 安全收敛：__amToken 只在请求本身携带有效令牌（header 或 ?token=）
        时才注入真实值；未授权请求注入 null——修复此前"任意本机进程 GET /
        即可从 HTML 提取明文 token 获得完整控制面"的凭据泄露。
        正常入口是 start_agent_mcp --open 生成的 /#token=... 链接。"""
        root = self.server.web_root.resolve()
        path = root / "index.html"
        if not path.is_file():
            self.send_error(404)
            return
        data = path.read_bytes()
        token_value = self.server.token if self._has_valid_token() else None
        token_script = (f'<script>window.__amToken={json.dumps(token_value)};</script>'
                        .encode("utf-8"))
        if b"window.__amToken=" not in data:
            data = data.replace(b"</head>", token_script + b"</head>", 1)
        marker = b'<script type="module" src="/panels/loader.js?v=v4"></script>'
        if marker not in data:
            if b"</body>" in data:
                data = data.replace(b"</body>", marker + b"</body>", 1)
            else:
                data = data + marker
        self.send_response(200)
        self._security_headers()
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_file(self, name: str):
        root = self.server.web_root.resolve()
        path = (root / name).resolve()
        if not path.is_file() or root not in path.parents:
            self.send_error(404)
            return
        data = path.read_bytes()
        self.send_response(200)
        self._security_headers()
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".mjs": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".ico": "image/x-icon",
        }.get(path.suffix.lower(), "application/octet-stream")
        # 面板 JS/CSS 迭代频繁：禁缓存，防浏览器命中旧模块（曾导致面板 401/旧逻辑）
        if path.suffix.lower() in (".js", ".mjs", ".css"):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return {}
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return {}
