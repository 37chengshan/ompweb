"""记忆银行（阶段 1）测试：project_memory 表 + memory_store/memory_recall 工具 + FINAL_ANSWER 自动沉淀。

覆盖：store+recall 往返与字段完整性、LIKE 检索命中/不命中、kind 过滤、
session_id 隔离、limit 截断、_sink_final_answer 提取写入与空值不写。
单测直连 Dispatcher + 临时 state_dir（复用 test_dispatcher 的 _make 风格），不起真实子进程。
"""
import json

from agent_mcp.daemon_main import Dispatcher
from agent_mcp.daemon_http import EventBroadcaster
from agent_mcp.db import DB


def _make(tmp_path):
    """临时 DB + EventBroadcaster + Dispatcher（不 start，记忆工具不走 worker）。"""
    db = DB(tmp_path / "test.db")
    bc = EventBroadcaster(max_clients=4)
    d = Dispatcher(db=db, broadcaster=bc, state_dir=tmp_path,
                   max_concurrent=4, monitor_interval=0.05)
    return d, db


def test_store_recall_roundtrip_fields(tmp_path):
    """store 后 recall 返完整字段：id/kind/key/content/tags/created_at/source。"""
    d, db = _make(tmp_path)
    res = d.memory_store({"session_id": "s1", "content": "用 stdlib sqlite 而非外部依赖",
                          "kind": "decision", "key": "zero-dep",
                          "tags": "架构 依赖", "source": "manual"})
    assert res["status"] == "stored" and res["id"] == 1

    out = d.memory_recall({"session_id": "s1"})
    mems = out["memories"]
    assert len(mems) == 1
    m = mems[0]
    assert m["id"] == 1
    assert m["kind"] == "decision"
    assert m["key"] == "zero-dep"
    assert m["content"] == "用 stdlib sqlite 而非外部依赖"
    assert m["tags"] == "架构 依赖"
    assert m["source"] == "manual"
    assert m["created_at"]
    # 落库行与返参一致
    row = db.recall_memories("s1")[0]
    assert row["content"] == m["content"]


def test_recall_keyword_like_hit_and_miss(tmp_path):
    """query 关键词 LIKE 命中 content/key/tags；无关词不命中。"""
    d, _ = _make(tmp_path)
    d.memory_store({"session_id": "s1", "content": "WAL 模式支持并发读",
                    "key": "wal-note", "tags": "sqlite"})
    d.memory_store({"session_id": "s1", "content": "接口命名定稿 memory_store"})

    # 命中 content
    hit = d.memory_recall({"session_id": "s1", "query": "并发读"})["memories"]
    assert [m["id"] for m in hit] == [1]
    # 命中 key
    hit = d.memory_recall({"session_id": "s1", "query": "wal-note"})["memories"]
    assert [m["id"] for m in hit] == [1]
    # 命中 tags
    hit = d.memory_recall({"session_id": "s1", "query": "sqlite"})["memories"]
    assert [m["id"] for m in hit] == [1]
    # 不命中
    miss = d.memory_recall({"session_id": "s1", "query": "不存在的词"})["memories"]
    assert miss == []


def test_recall_kind_filter(tmp_path):
    """kind 过滤只返该类型记忆。"""
    d, _ = _make(tmp_path)
    d.memory_store({"session_id": "s1", "content": "a lesson", "kind": "lesson"})
    d.memory_store({"session_id": "s1", "content": "a decision", "kind": "decision"})

    lessons = d.memory_recall({"session_id": "s1", "kind": "lesson"})["memories"]
    assert [m["content"] for m in lessons] == ["a lesson"]
    decisions = d.memory_recall({"session_id": "s1", "kind": "decision"})["memories"]
    assert [m["content"] for m in decisions] == ["a decision"]
    finals = d.memory_recall({"session_id": "s1", "kind": "final_answer"})["memories"]
    assert finals == []


def test_recall_session_isolation(tmp_path):
    """不同 session 互不可见；缺省 session_id 落在 'default' 隔离桶。"""
    d, _ = _make(tmp_path)
    d.memory_store({"session_id": "s1", "content": "s1 私有记忆"})
    d.memory_store({"content": "default 桶记忆"})  # 无 session_id → default

    assert d.memory_recall({"session_id": "s2"})["memories"] == []
    assert [m["content"] for m in d.memory_recall({"session_id": "s1"})["memories"]] == ["s1 私有记忆"]
    # 缺省 session 只看到 default 桶
    assert [m["content"] for m in d.memory_recall({})["memories"]] == ["default 桶记忆"]


def test_recall_limit_truncation(tmp_path):
    """limit 截断条数；超限按 20 钳制、非法值回退默认 5。"""
    d, _ = _make(tmp_path)
    for i in range(7):
        d.memory_store({"session_id": "s1", "content": f"记忆 {i}"})

    assert len(d.memory_recall({"session_id": "s1", "limit": 3})["memories"]) == 3
    assert len(d.memory_recall({"session_id": "s1", "limit": 100})["memories"]) == 7  # 只有 7 条
    assert len(d.memory_recall({"session_id": "s1", "limit": "abc"})["memories"]) == 5  # 非法回退


def test_sink_final_answer_writes_and_recalls(tmp_path):
    """summary 含 FINAL_ANSWER: → 写入 kind=final_answer 记忆（source=agent:<id>）并可 recall。"""
    d, db = _make(tmp_path)
    # 先建一条 agent 记录，让 source 指向真实 agent_id
    aid = db.insert_agent(parent_id=None, session_id="s1", task_name="t",
                          cli="claude", model=None, cwd=str(tmp_path))
    d._sink_final_answer(aid, "过程无关文本\nFINAL_ANSWER: 完成，测试全绿", "s1")

    mems = db.recall_memories("s1", kind="final_answer")
    assert len(mems) == 1
    m = mems[0]
    assert m["content"] == "完成，测试全绿"  # 去首尾空白
    assert m["source"] == f"agent:{aid}"
    # 经工具层也可召回
    out = d.memory_recall({"session_id": "s1", "kind": "final_answer"})["memories"]
    assert out[0]["content"] == "完成，测试全绿"


def test_sink_final_answer_skips_when_absent_or_empty(tmp_path):
    """无 FINAL_ANSWER 标记或标记后为空 → 不写记忆。"""
    d, db = _make(tmp_path)
    d._sink_final_answer(1, "普通完成文本，无标记", "s1")
    d._sink_final_answer(1, "FINAL_ANSWER:", "s1")
    d._sink_final_answer(1, "FINAL_ANSWER:   \n", "s1")
    assert db.recall_memories("s1") == []
