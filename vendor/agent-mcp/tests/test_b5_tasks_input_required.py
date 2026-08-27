"""B5：MCP Tasks 扩展的 needs_advisor → input_required 协议级映射测试。

daemon 的 NEEDS_DECISION 机制此前只在本项目事件流可见；映射后，支持
2026-07-28 Tasks 扩展的宿主可通过 tasks/get 感知"需要人工决策"状态，
并用 tasks/update(inputResponses)（已映射 steer_agent）回填决策，
形成协议级双向闭环。
"""
import mcp_server


def test_task_status_maps_needs_advisor_to_input_required():
    assert mcp_server._task_status({"status": "needs_advisor"}) == "input_required"
    assert mcp_server._task_status({"status": "running"}) == "working"
    assert mcp_server._task_status({"status": "terminated"}) == "completed"


def test_task_result_surfaces_decision_question():
    task = mcp_server._task_result({
        "agent_id": 7, "status": "needs_advisor",
        "stop_reason": "needs_decision",
        "summary": "NEEDS_DECISION: 选 sqlite 还是 postgres？\nwhy: 并发写冲突",
    })
    assert task["status"] == "input_required"
    content = task["result"]["content"][0]["text"]
    assert "sqlite 还是 postgres" in content
    assert task["result"]["resultType"] == "input_required"


def test_task_result_input_required_fallback_text():
    task = mcp_server._task_result({
        "agent_id": 8, "status": "needs_advisor",
        "stop_reason": "needs_decision", "summary": ""})
    assert task["status"] == "input_required"
    assert task["result"]["content"][0]["text"] == "needs_decision"
