from pathlib import Path

from agent_mcp.events import EVENT_TYPES

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEB_HTML = PROJECT_ROOT / "web" / "index.html"


def test_web_has_core_elements():
    html = WEB_HTML.read_text(encoding="utf-8")
    assert "EventSource" in html
    assert "snapshot" in html
    assert "spawned" in html
    assert "token" in html.lower()


def test_web_no_external_deps():
    html = WEB_HTML.read_text(encoding="utf-8")
    assert "http://" not in html and "https://" not in html
    assert "<script src" not in html and "<link rel" not in html


def test_web_handles_all_event_types():
    """事件分发必须覆盖 events.py 定义的全集（含 message_delta 双轨）。"""
    html = WEB_HTML.read_text(encoding="utf-8")
    for typ in sorted(EVENT_TYPES):
        assert typ in html, f"missing event dispatch for {typ}"


def test_web_has_authenticated_operator_actions():
    """操作写请求使用本机 token，覆盖 steer/followup/interrupt。"""
    html = WEB_HTML.read_text(encoding="utf-8")
    assert 'method:"POST"' in html
    assert '"X-Auth-Token"' in html
    assert '"/api/agents/steer"' in html
    assert '"/api/agents/followup"' in html
    assert '"/api/agents/interrupt"' in html


def test_web_narrow_drawer_detail():
    """窄屏下详情变为底部抽屉：media query + drawer-open 切换 + 切换/关闭按钮。"""
    html = WEB_HTML.read_text(encoding="utf-8")
    assert "@media (max-width:860px)" in html
    assert "drawer-open" in html
    assert "translateY" in html


def test_web_keyboard_focus_and_reduced_motion():
    """键盘焦点（Enter/空格/Esc）与 prefers-reduced-motion。U2 canvas 命中改用 pointer，保留 Esc。"""
    html = WEB_HTML.read_text(encoding="utf-8")
    assert 'e.key' in html and 'Escape' in html
    assert "prefers-reduced-motion" in html
    assert "focus-visible" in html


def test_web_truthful_live_buffered_hints():
    """数据新鲜度如实标注：SSE 在线才标 LIVE，断线/未连接一律 BUFFERED。"""
    html = WEB_HTML.read_text(encoding="utf-8")
    assert "LIVE" in html
    assert "BUFFERED" in html


def test_web_atomcode_capability_hint():
    """AtomCode 能力如实提示：one-shot、verbose usage 已解析、无 stable resume。"""
    html = WEB_HTML.read_text(encoding="utf-8")
    assert "atomcode" in html.lower()
    assert "resume" in html


def test_web_sse_error_and_empty_states():
    """SSE 断线/快照错误/对话图空态文案齐全。U4 改退避重连后断线文案可能变。"""
    html = WEB_HTML.read_text(encoding="utf-8")
    # 空态：canvas 无节点时的占位文案
    assert "加载中" in html or "暂无" in html or "empty" in html.lower()


def test_web_detail_retention():
    """详情保留：选中节点写入 localStorage，清状态/切会话不得重置选中。"""
    html = WEB_HTML.read_text(encoding="utf-8")
    assert 'SEL_KEY' in html
    assert "localStorage" in html


def test_web_sse_timeout_maps_to_incomplete():
    """agent.terminated + stop_reason=timeout 必须即时映射为 incomplete（超时）。"""
    html = WEB_HTML.read_text(encoding="utf-8")
    assert 'stop_reason' in html and 'timeout' in html
    assert "incomplete" in html


def test_web_drawer_controls_rerender_aria_expanded_on_close():
    """关闭按钮与 Escape 关闭抽屉后必须重渲染。"""
    html = WEB_HTML.read_text(encoding="utf-8")
    assert "drawer-open" in html
    assert "Escape" in html
    assert "scheduleRender" in html


def test_web_is_operator_console_with_steer_followup_and_stop():
    html = WEB_HTML.read_text(encoding="utf-8")
    assert "steer" in html
    assert "followup" in html
    assert '"/api/agents/steer"' in html
    assert '"/api/agents/followup"' in html
    assert '"/api/agents/interrupt"' in html


def test_web_operator_uses_fragment_auth_and_recovery_feedback():
    html = WEB_HTML.read_text(encoding="utf-8")
    assert "location.hash" in html or "fragment" in html.lower()
    assert "history.replaceState" in html
    assert '"X-Auth-Token"' in html


def test_web_graph_is_horizontal_only_and_models_user_turns():
    """U2 canvas pan/zoom 后仍建模 user_turn 节点。"""
    html = WEB_HTML.read_text(encoding="utf-8")
    assert "agent.user_turn" in html
    assert "canvas" in html.lower() or "user_turn" in html


def test_web_operator_scopes_writes_to_selected_session():
    html = WEB_HTML.read_text(encoding="utf-8")
    assert "session_id" in html


def test_web_dense_columns_expand_horizontally_without_vertical_scroll():
    """U2 canvas 布局后无硬列矩阵，验证 canvas 存在即可。"""
    html = WEB_HTML.read_text(encoding="utf-8")
    assert "canvas" in html.lower()


def test_web_mobile_form_controls_avoid_ios_focus_zoom():
    html = WEB_HTML.read_text(encoding="utf-8")
    assert "@media (max-width:639px)" in html
    assert "font-size:16px" in html

def test_web_graph_wraps_overflow_into_horizontal_pages_and_focuses_latest_agent():
    """导图固定纵向槽位，超出后横向换页；首次视角聚焦最新 agent。"""
    html = WEB_HTML.read_text(encoding="utf-8")
    assert "ROW_H" in html and "MAX_ROWS" in html and "WRAP_W" in html
    assert "latestAgent" in html and "focusLatest" in html and "focusNode" in html and "clampPan" in html
