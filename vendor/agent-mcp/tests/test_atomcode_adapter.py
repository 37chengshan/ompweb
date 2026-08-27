import shutil
import subprocess

import pytest

from agent_mcp.cli_adapters import AtomCodeAdapter, get_adapter


def _build(adapter, **overrides):
    kwargs = {
        "prompt": "只回复 OK，不调用工具",
        "cwd": "/tmp/work tree",
        "model": None,
        "permission_mode": "plan",
        "max_turns": 8,
        "resume": None,
    }
    kwargs.update(overrides)
    return adapter.build_command(**kwargs)


def test_atomcode_binary_uses_path_then_home_fallback(monkeypatch):
    adapter = AtomCodeAdapter()
    seen = []

    def fake_which(candidate):
        seen.append(candidate)
        return "/resolved/atomcode" if candidate == adapter._BIN[1] else None

    monkeypatch.setattr("agent_mcp.cli_adapters.shutil.which", fake_which)
    assert adapter.binary() == "/resolved/atomcode"
    assert seen == adapter._BIN


def test_atomcode_command_contains_cwd_model_and_prompt(monkeypatch):
    adapter = AtomCodeAdapter()
    monkeypatch.setattr(adapter, "binary", lambda: "/bin/atomcode")
    command = _build(adapter, model="atom-model", permission_mode="acceptEdits")
    assert command == [
        "/bin/atomcode",
        "-C",
        "/tmp/work tree",
        "--model",
        "atom-model",
        "-v",
        "-p",
        "只回复 OK，不调用工具",
    ]
    assert "-v" in command


@pytest.mark.parametrize(
    ("mode", "expected"),
    [
        ("plan", []),
        ("acceptEdits", []),
        ("fullAccess", ["--dangerously-skip-permissions"]),
    ],
)
def test_atomcode_permission_mappings_match_installed_cli(monkeypatch, mode, expected):
    adapter = AtomCodeAdapter()
    monkeypatch.setattr(adapter, "binary", lambda: "/bin/atomcode")
    command = _build(adapter, permission_mode=mode)
    for part in expected:
        assert part in command
    if mode in {"plan", "acceptEdits"}:
        assert "--disable-tools" not in command
        assert "--dangerously-skip-permissions" not in command

def test_atomcode_ignores_max_turns(monkeypatch):
    adapter = AtomCodeAdapter()
    monkeypatch.setattr(adapter, "binary", lambda: "/bin/atomcode")
    assert "8" not in _build(adapter, max_turns=8)
    assert "50" not in _build(adapter, max_turns=50)


def test_atomcode_rejects_resume(monkeypatch):
    adapter = AtomCodeAdapter()
    monkeypatch.setattr(adapter, "binary", lambda: "/bin/atomcode")
    with pytest.raises(ValueError, match="AtomCode does not support stable session-id resume"):
        _build(adapter, resume="session-1")


def test_atomcode_multiline_stdout_becomes_one_message():
    events, usage = AtomCodeAdapter().parse_stream(["first", "second\n", ""])
    assert events == [{"type": "agent.message", "payload": {"text": "first\nsecond"}}]
    assert usage == {}


def test_atomcode_empty_stdout_emits_nothing():
    events, usage = AtomCodeAdapter().parse_stream(["", " \n"])
    assert events == [] and usage == {}


def test_atomcode_plain_or_malformed_text_never_raises():
    events, usage = AtomCodeAdapter().parse_stream(["{not-json", "plain text"])
    assert events[0]["payload"]["text"] == "{not-json\nplain text"
    assert usage == {}
    assert AtomCodeAdapter().extract_session_id({"session_id": "ignored"}) is None


def test_atomcode_verbose_usage_is_parsed_without_polluting_message():
    events, usage = AtomCodeAdapter().parse_stream([
        "最终回答",
        "[tokens] prompt=16573 completion=2 cached=6144",
        "[done] 13.7s tokens=16.57K turns=1 tool_calls=0",
    ])
    assert events == [{"type": "agent.message", "payload": {"text": "最终回答"}},
                      {"type": "agent.usage", "payload": usage}]
    # cached 修后 input_tokens 含 cached（16573+6144=22717），cache_read 仍 6144
    assert usage == {"input_tokens": 22717, "output_tokens": 2,
                     "cache_creation": 0, "cache_read": 6144, "cost_usd": 0.0}


def test_atomcode_usage_line_may_be_only_output():
    events, usage = AtomCodeAdapter().parse_stream([
        "[tokens] prompt=10 completion=5 cached=0",
    ])
    assert events == [{"type": "agent.usage", "payload": usage}]
    assert usage["input_tokens"] == 10 and usage["output_tokens"] == 5


def test_get_adapter_returns_atomcode():
    assert isinstance(get_adapter("atomcode"), AtomCodeAdapter)


@pytest.mark.integration
def test_atomcode_real_plan_mode_smoke(tmp_path):
    adapter = AtomCodeAdapter()
    if not adapter.binary():
        pytest.skip("AtomCode binary missing")
    command = adapter.build_command(
        prompt="只回复 OK，不调用工具",
        cwd=str(tmp_path),
        model=None,
        permission_mode="plan",
        max_turns=8,
        resume=None,
    )
    process = subprocess.run(command, capture_output=True, text=True, timeout=120)
    assert process.returncode == 0, process.stderr
    assert process.stdout.strip()
    events, usage = adapter.parse_stream(process.stdout.splitlines())
    assert any(event["type"] == "agent.message" for event in events)
    assert usage == {}
