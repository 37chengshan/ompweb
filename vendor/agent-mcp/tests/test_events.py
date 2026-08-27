import pytest
from agent_mcp.events import Event, EVENT_TYPES, normalize_event

def test_event_roundtrip():
    e = Event(agent_id="a1", type="agent.message", payload={"text": "hi"}, session_id="s1")
    d = e.to_dict()
    assert normalize_event(d) == e

def test_normalize_unknown_type_rejected():
    with pytest.raises(ValueError):
        normalize_event({"agent_id": "a1", "type": "bogus.type"})

def test_delta_not_persisted_flag():
    e = Event(agent_id="a1", type="agent.message_delta", payload={})
    assert not e.persist

def test_event_types_exist():
    for t in ("agent.spawned", "agent.running", "agent.message", "agent.message_delta",
              "agent.tool_use", "agent.tool_result", "agent.usage", "agent.thread_message_sent",
              "agent.thread_message_received", "agent.idle", "agent.terminated",
              "agent.error", "agent.cancelled"):
        assert t in EVENT_TYPES
