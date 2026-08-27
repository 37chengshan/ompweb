import mcp_server


def test_resources_list_and_read():
    # Test resources/list
    out = []
    list_req = {"jsonrpc": "2.0", "id": 1, "method": "resources/list", "params": {}}
    mcp_server.handle(list_req, emit=out.append)
    assert len(out) == 1
    resp = out[0]
    assert resp["id"] == 1
    resources = resp["result"]["resources"]
    assert len(resources) >= 3
    uris = [r["uri"] for r in resources]
    assert "agent-mcp://agents/status" in uris
    assert "agent-mcp://policies/current" in uris
    assert "agent-mcp://stats/tokens" in uris

    # Test resources/read
    out.clear()
    read_req = {
        "jsonrpc": "2.0",
        "id": 2,
        "method": "resources/read",
        "params": {"uri": "agent-mcp://policies/current"}
    }
    mcp_server.handle(read_req, emit=out.append)
    assert len(out) == 1
    resp2 = out[0]
    assert resp2["id"] == 2
    contents = resp2["result"]["contents"]
    assert len(contents) == 1
    assert contents[0]["uri"] == "agent-mcp://policies/current"


def test_prompts_list_and_get():
    # Test prompts/list
    out = []
    list_req = {"jsonrpc": "2.0", "id": 3, "method": "prompts/list", "params": {}}
    mcp_server.handle(list_req, emit=out.append)
    assert len(out) == 1
    resp = out[0]
    assert resp["id"] == 3
    prompts = resp["result"]["prompts"]
    assert len(prompts) >= 2
    p_names = [p["name"] for p in prompts]
    assert "dag_orchestration" in p_names
    assert "cross_vendor_review" in p_names

    # Test prompts/get
    out.clear()
    get_req = {
        "jsonrpc": "2.0",
        "id": 4,
        "method": "prompts/get",
        "params": {
            "name": "dag_orchestration",
            "arguments": {"task": "Refactor database module"}
        }
    }
    mcp_server.handle(get_req, emit=out.append)
    assert len(out) == 1
    resp2 = out[0]
    assert resp2["id"] == 4
    messages = resp2["result"]["messages"]
    assert len(messages) == 1
    assert "Refactor database module" in messages[0]["content"]["text"]
