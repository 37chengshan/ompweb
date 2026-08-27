"""B2 适配器 usage 结算语义契约测试。

BaseAdapter.usage_semantics ∈ {"authoritative","cumulative"} 是 daemon 统一
结算的依据（daemon_main._ingest_output 据此决定是否用空总量覆盖既有累计）。
本文件锁住：①所有适配器都显式声明合法值；②已知口径映射不被无意改动；
③GenericAdapter 可配置且校验非法值；④daemon 端权威口径防清账守卫生效。
"""
import json

import pytest

from agent_mcp import cli_adapters
from agent_mcp.cli_adapters import (
    BaseAdapter, CodexAdapter, ClineAdapter, CopilotAdapter, GenericAdapter,
    KimiAdapter, AtomCodeAdapter, OmpAdapter, OpencodeAdapter, PiAdapter,
    ZcodeAdapter,
)
from agent_mcp.daemon_http import EventBroadcaster
from agent_mcp.daemon_main import Dispatcher
from agent_mcp.db import DB

VALID = {"authoritative", "cumulative"}

# 实测口径登记表（改动任何一行都应同步 capability-matrix 与 cli-guide）
KNOWN: list[tuple[type, str]] = [
    (BaseAdapter, "authoritative"),
    (CodexAdapter, "authoritative"),
    (AtomCodeAdapter, "authoritative"),
    (KimiAdapter, "authoritative"),
    (CopilotAdapter, "authoritative"),
    (PiAdapter, "authoritative"),
    (ZcodeAdapter, "authoritative"),
    (ClineAdapter, "authoritative"),
    (OmpAdapter, "cumulative"),      # 逐 turn 累计（实测）
    (OpencodeAdapter, "cumulative"), # 逐 turn 累计（实测）
]


@pytest.mark.parametrize("cls,expected", KNOWN)
def test_known_usage_semantics(cls, expected):
    assert cls.usage_semantics == expected


def test_all_builtin_adapters_declare_valid_semantics():
    for attr in dir(cli_adapters):
        obj = getattr(cli_adapters, attr)
        if not isinstance(obj, type) or not issubclass(obj, BaseAdapter):
            continue
        if obj is BaseAdapter:
            continue
        assert obj.usage_semantics in VALID, f"{attr}.usage_semantics 非法"


def test_generic_adapter_configures_and_validates_semantics():
    base = {"cli_name": "mycli",
            "command": {"prefix": ["-p"]},
            "parse": {"mode": "text"}}
    g_default = GenericAdapter(dict(base))
    assert g_default.usage_semantics == "authoritative"
    cfg = dict(base, usage_semantics="cumulative")
    assert GenericAdapter(cfg).usage_semantics == "cumulative"
    with pytest.raises(ValueError, match="usage_semantics"):
        GenericAdapter(dict(base, usage_semantics="whatever"))


def test_daemon_authoritative_empty_usage_does_not_clobber(tmp_path, monkeypatch):
    """权威口径下尾随零总量不得覆盖已有累计（B2 防清账守卫）。"""
    db = DB(tmp_path / "u.sqlite3")
    disp = Dispatcher(db=db, broadcaster=EventBroadcaster(),
                      state_dir=tmp_path / "state", spawn_fn=lambda *a, **k: {})
    agent_id = db.insert_agent(parent_id=None, session_id="s", task_name="t",
                               cli="claude")
    db.upsert_usage(agent_id=agent_id, model="aggregate", input_tokens=500,
                    output_tokens=200, cache_creation=0, cache_read=0,
                    cost_usd=0.01)

    class StubAdapter(BaseAdapter):
        cli_name = "claude"
        usage_semantics = "authoritative"

        def parse_stream(self, lines):
            return [], {"input_tokens": 0, "output_tokens": 0,
                        "cache_creation": 0, "cache_read": 0, "cost_usd": 0.0}

        def extract_session_id(self, raw):
            return None

    monkeypatch.setattr(daemon_main_mod(), "get_adapter", lambda cli: StubAdapter())
    out_path = tmp_path / "out.log"
    out_path.write_text("{}\n")
    disp._ingest_output(agent_id, "claude", out_path, "s")

    totals = db.usage_total(agent_id)
    assert int(totals.get("input_tokens") or 0) == 500  # 未被零覆盖


def daemon_main_mod():
    import agent_mcp.daemon_main as dm
    return dm


def test_custom_cli_example_files_are_valid_configs():
    """仓库内置的 custom-clis 示例必须能通过 GenericAdapter 校验。"""
    from pathlib import Path
    examples_dir = Path(__file__).resolve().parent.parent / "docs" / "custom-cli-examples"
    for path in sorted(examples_dir.glob("*.json")):
        cfg = json.loads(path.read_text(encoding="utf-8"))
        adapter = GenericAdapter(cfg)  # 不抛即合法
        assert adapter.usage_semantics in VALID
