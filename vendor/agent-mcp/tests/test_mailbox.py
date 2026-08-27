"""P2P Mailbox 单元测试。"""
import os
import tempfile
import pytest

from agent_mcp.db import DB
from agent_mcp.mailbox import MailboxManager


@pytest.fixture
def test_db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    db = DB(path)
    yield db
    if os.path.exists(path):
        os.remove(path)


def test_mailbox_p2p_and_broadcast(test_db):
    mb = MailboxManager(test_db)
    
    # 1. 广播消息
    msg_id1 = mb.broadcast("team_alpha", from_agent_id=101, message="Hello everyone!")
    assert msg_id1 > 0
    
    # 2. 点对点私信
    msg_id2 = mb.send_direct("team_alpha", from_agent_id=101, to_agent_id=102, message="Only for agent 102")
    assert msg_id2 > 0
    
    # 3. Agent 102 查信箱：应收到 2 条（1 条广播 + 1 条给它的私信）
    inbox_102 = mb.fetch_inbox("team_alpha", agent_id=102, unread_only=True)
    assert len(inbox_102) == 2
    
    # 4. Agent 103 查信箱：应只收到 1 条（广播），收不到给 102 的私信
    inbox_103 = mb.fetch_inbox("team_alpha", agent_id=103, unread_only=True)
    assert len(inbox_103) == 1
    assert inbox_103[0]["message"] == "Hello everyone!"
    
    # 5. Agent 102 读完标记已读
    read_count = mb.mark_read([m["id"] for m in inbox_102])
    assert read_count == 2
    
    # 再次查询 unread 应为空
    inbox_102_after = mb.fetch_inbox("team_alpha", agent_id=102, unread_only=True)
    assert len(inbox_102_after) == 0


def test_mailbox_consensus_voting(test_db):
    mb = MailboxManager(test_db)
    team = "team_vote"
    
    # 发送提案
    mb.broadcast(team, from_agent_id=1, message="Proposal: deploy to prod", msg_type="proposal")
    
    # 两个 agent 投赞成票，一个投反对票
    mb.send_vote(team, from_agent_id=1, vote=True, reason="ready")
    mb.send_vote(team, from_agent_id=2, vote=True, reason="tested")
    mb.send_vote(team, from_agent_id=3, vote=False, reason="need more perf tests")
    
    summary = mb.tally_votes(team)
    assert summary["approve"] == 2
    assert summary["reject"] == 1
    assert summary["total"] == 3
    assert summary["passed"] is True  # 超过半数
