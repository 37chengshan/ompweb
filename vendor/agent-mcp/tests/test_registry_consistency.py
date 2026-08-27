"""A4 注册一致性与吞噬基线守卫（v3.0 路线图，零重构方案）。

背景：新增一个 MCP 工具需同步四处——mcp_server.TOOLS（schema）、
mcp_server._DAEMON_PATHS（工具→daemon 路由）、daemon_http._API_METHODS
（路径→Dispatcher 方法名）、Dispatcher 方法本体。f7a948e 的 mailbox/audit
断线正是漏改导致的。本文件用纯测试把四方锁死：任何一处漏改即 CI 红，
不引入重构风险。

第二部分是"静默异常吞噬"数量基线：`except ...: pass` 允许存在（多数是
有意的 best-effort 回退），但只许减少不许增加——新增必须留痕（日志/事件）
或有意识地抬高基线并在评审中说明。
"""
import re
import pathlib

import pytest

import mcp_server
from agent_mcp.daemon_http import _API_METHODS
from agent_mcp.daemon_main import Dispatcher

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent

# 静默吞噬基线（2026-08-24 盘点）：文件名 → 允许的 `except: pass` 数量上限。
# 只准下调；需要上调时必须在 PR 里给出理由（新增处为何无法留痕）。
SILENT_SWALLOW_BASELINE = {
    "mcp_server.py": 1,
    "dispatch_worker.py": 7,
    "agent_mcp/db.py": 3,
    "agent_mcp/daemon_main.py": 6,
    "agent_mcp/audit.py": 1,
    "agent_mcp/dispatch.py": 2,
    "agent_mcp/daemon_http.py": 2,
}

# 与盘点脚本相同的匹配口径：except 行后紧跟缩进 pass
_SWALLOW_RE = re.compile(r"except[^\n]*:\n(\s+)pass\n")


def _tool_names():
    return [t["name"] for t in mcp_server.TOOLS]


# ---- 四方注册一致性 ----

def test_every_tool_routes_somewhere():
    """每个 MCP 工具要么在 _DAEMON_PATHS（走 daemon），要么在 _LOCAL_TOOLS（薄层直算）。"""
    for name in _tool_names():
        assert name in mcp_server._DAEMON_PATHS or name in mcp_server._LOCAL_TOOLS, (
            f"工具 {name} 既无 daemon 路由也非本地直算——调用必然报 unknown tool"
        )


def test_no_orphan_daemon_paths():
    """_DAEMON_PATHS 的每个键都必须是真实注册的工具名（防改名后路由残留）。"""
    for name in mcp_server._DAEMON_PATHS:
        assert name in _tool_names(), f"_DAEMON_PATHS 含未知工具 {name}"


def test_local_tools_are_exactly_the_unrouted_ones():
    """本地直算集合 = 工具全集 − daemon 路由集合，不多不少。"""
    local_expected = set(_tool_names()) - set(mcp_server._DAEMON_PATHS)
    assert set(mcp_server._LOCAL_TOOLS) == local_expected


def test_daemon_paths_exist_in_http_route_table():
    """_DAEMON_PATHS 的每条路径都必须在 daemon_http._API_METHODS 有注册。"""
    for tool, path in mcp_server._DAEMON_PATHS.items():
        assert path in _API_METHODS, f"{tool} 的路由 {path} 未在 _API_METHODS 注册"


def test_route_table_has_no_orphan_api_entries():
    """_API_METHODS 不应有游离于 _DAEMON_PATHS 之外的 API 条目
    （workspace 等非 MCP 工具路由在独立表 _WORKSPACE_POST，不受此约束）。"""
    routed_paths = set(mcp_server._DAEMON_PATHS.values())
    orphans = set(_API_METHODS) - routed_paths
    assert orphans == set(), f"游离子路由（无对应 MCP 工具）: {sorted(orphans)}"


def test_every_routed_method_exists_on_dispatcher():
    """反射约定成立的前提：_API_METHODS 的方法名必须是 Dispatcher 真实方法。
    f7a948e 的 mailbox 断线（调用不存在的方法）在此类测试下直接红。"""
    for path, method in _API_METHODS.items():
        assert callable(getattr(Dispatcher, method, None)), (
            f"路由 {path} 指向的 Dispatcher.{method} 不存在"
        )


# ---- 静默异常吞噬基线 ----

@pytest.mark.parametrize("rel_path,allowed", sorted(SILENT_SWALLOW_BASELINE.items()))
def test_silent_swallow_baseline(rel_path, allowed):
    src = (PROJECT_ROOT / rel_path).read_text(encoding="utf-8")
    count = len(_SWALLOW_RE.findall(src))
    assert count <= allowed, (
        f"{rel_path} 静默吞嗽数 {count} 超过基线 {allowed}——新 except 请留痕"
        f"（日志/事件流）；确属 best-effort 回退时同步上调本文件基线并说明理由"
    )


def test_silent_swallow_files_are_all_covered():
    """生产代码里出现静默吞噬的新文件必须登记进基线表（防止绕开逐文件基线）。"""
    covered = {PROJECT_ROOT / p for p in SILENT_SWALLOW_BASELINE}
    scanned = [PROJECT_ROOT / "mcp_server.py", PROJECT_ROOT / "dispatch_worker.py"]
    scanned += list((PROJECT_ROOT / "agent_mcp").rglob("*.py"))
    for p in scanned:
        if p in covered:
            continue
        count = len(_SWALLOW_RE.findall(p.read_text(encoding="utf-8")))
        assert count == 0, f"{p.relative_to(PROJECT_ROOT)} 出现 {count} 处静默吞噬但未登记基线"
