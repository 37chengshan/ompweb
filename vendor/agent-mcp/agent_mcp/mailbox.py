"""Agent 间点对点/广播信箱机制 (Mailbox)。

支持同一 team/dag/session 协作组下的 Agent 互相投递消息、结构化投票共识与状态同步。
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

MSG_TYPE_TEXT = "text"
MSG_TYPE_VOTE = "vote"
MSG_TYPE_SIGNAL = "signal"


@dataclass
class MailboxMessage:
    id: int
    team_id: str
    from_agent_id: int
    to_agent_id: int | None  # None 为广播给组内所有成员
    message: str
    msg_type: str = MSG_TYPE_TEXT
    read_at: str | None = None
    created_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "team_id": self.team_id,
            "from_agent_id": self.from_agent_id,
            "to_agent_id": self.to_agent_id,
            "message": self.message,
            "msg_type": self.msg_type,
            "read_at": self.read_at,
            "created_at": self.created_at,
        }


class MailboxManager:
    """Agent 信箱管理：与 DB 交互的协同通信中枢。"""

    def __init__(self, db: Any) -> None:
        self.db = db

    def send(self, team_id: str, from_agent_id: int, message: str, *,
             to_agent_id: int | None = None, msg_type: str = MSG_TYPE_TEXT,
             payload: Any = None) -> int:
        """发送点对点或广播消息，返回消息 ID。

        payload 非空时以 JSON 信封并入 message 字段（{"text": ..., "payload": ...}），
        不改表结构；fetch_inbox 返回原始行，信封由消费方按需解包。
        """
        if payload is not None:
            message = json.dumps({"text": message, "payload": payload},
                                 ensure_ascii=False)
        return self.db.mailbox_send(
            team_id=team_id,
            from_agent_id=from_agent_id,
            to_agent_id=to_agent_id,
            message=message,
            msg_type=msg_type,
        )

    def send_direct(self, team_id: str, from_agent_id: int, to_agent_id: int, message: str, *,
                    msg_type: str = MSG_TYPE_TEXT) -> int:
        """发送单播私信。"""
        return self.send(team_id=team_id, from_agent_id=from_agent_id, to_agent_id=to_agent_id,
                         message=message, msg_type=msg_type)

    def broadcast(self, team_id: str, from_agent_id: int, message: str, *,
                  msg_type: str = MSG_TYPE_TEXT) -> int:
        """发送组内广播消息。"""
        return self.send(team_id=team_id, from_agent_id=from_agent_id, to_agent_id=None,
                         message=message, msg_type=msg_type)

    def fetch_inbox(self, team_id: str, agent_id: int, *,
                    unread_only: bool = True, limit: int = 50) -> list[dict[str, Any]]:
        """获取目标 agent 的收件箱（包含私信与组内广播）。"""
        return self.db.mailbox_fetch(
            team_id=team_id,
            agent_id=agent_id,
            unread_only=unread_only,
            limit=limit,
        )

    def mark_read(self, message_ids: list[int]) -> int:
        """标记已读。"""
        return self.db.mailbox_mark_read(message_ids)

    def send_vote(self, team_id: str, from_agent_id: int, vote: bool | str, *,
                  topic: str | None = None, reason: str = "") -> int:
        """发送投票（支持 bool 或具体选项字符串）。"""
        vote_str = "approve" if vote is True else ("reject" if vote is False else str(vote))
        payload = json.dumps({"topic": topic, "choice": vote_str, "reason": reason}, ensure_ascii=False)
        return self.broadcast(team_id=team_id, from_agent_id=from_agent_id, message=payload, msg_type=MSG_TYPE_VOTE)

    def tally_votes(self, team_id: str, topic: str | None = None) -> dict[str, Any]:
        """统计组内投票。"""
        messages = self.db.mailbox_fetch_team_messages(team_id=team_id, msg_type=MSG_TYPE_VOTE)
        latest_vote_per_agent: dict[int, str] = {}
        for m in sorted(messages, key=lambda x: x["created_at"]):
            msg_content = m["message"].strip()
            choice = msg_content
            try:
                data = json.loads(msg_content)
                if isinstance(data, dict):
                    msg_topic = data.get("topic")
                    if topic and msg_topic != topic:
                        continue
                    choice = data.get("choice", msg_content)
            except Exception:
                if topic and not msg_content.startswith(f"{topic}:"):
                    continue
                if topic and msg_content.startswith(f"{topic}:"):
                    choice = msg_content.split(f"{topic}:", 1)[1].strip()
            latest_vote_per_agent[m["from_agent_id"]] = choice

        tally: dict[str, Any] = {"approve": 0, "reject": 0, "total": len(latest_vote_per_agent)}
        for choice in latest_vote_per_agent.values():
            tally[choice] = tally.get(choice, 0) + 1
        approve_count = tally.get("approve", 0)
        tally["passed"] = approve_count > (len(latest_vote_per_agent) / 2) if latest_vote_per_agent else False
        return tally
