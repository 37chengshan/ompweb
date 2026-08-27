from __future__ import annotations
import json
from dataclasses import dataclass, field, asdict
from typing import Any

EVENT_TYPES = frozenset({
    "agent.spawned", "agent.user_turn", "agent.running", "agent.message", "agent.message_delta",
    "agent.tool_use", "agent.tool_result", "agent.usage",
    "agent.thread_message_sent", "agent.thread_message_received",
    "agent.idle", "agent.terminated", "agent.error", "agent.cancelled",
    # 异常/运维路径（daemon 广播但不在常规链路；需持久化 + 前端可见）
    "agent.orphaned", "agent.needs_advisor",
    "agent.verify_failed", "agent.verify_passed",
    "agent.budget_downgrade", "agent.ingest_failed", "agent.audit_failed",
})
NON_PERSISTED = frozenset({"agent.message_delta"})

@dataclass
class Event:
    agent_id: str
    type: str
    payload: dict[str, Any] = field(default_factory=dict)
    session_id: str = ""
    seq: int | None = None
    created_at: str = ""

    @property
    def persist(self) -> bool:
        return self.type not in NON_PERSISTED

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

def normalize_event(raw: dict[str, Any]) -> Event:
    if not isinstance(raw, dict) or raw.get("type") not in EVENT_TYPES:
        raise ValueError(f"unknown or missing event type: {raw.get('type')!r}")
    return Event(
        agent_id=str(raw.get("agent_id", "")),
        type=raw["type"],
        payload=raw.get("payload") or {},
        session_id=str(raw.get("session_id", "")),
        seq=raw.get("seq"),
        created_at=str(raw.get("created_at", "")),
    )

def event_to_json(event: Event) -> str:
    return json.dumps(event.to_dict(), ensure_ascii=False, separators=(",", ":"))
