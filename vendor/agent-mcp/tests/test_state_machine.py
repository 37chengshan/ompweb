import pytest
from agent_mcp.state_machine import (
    STATUS_QUEUED, STATUS_RUNNING, STATUS_TERMINATED, STATUS_ERROR,
    STATUS_CANCELLED, STATUS_INCOMPLETE,
    transition, classify_exit, stop_reason_for_exit,
)

def test_valid_transitions():
    assert transition(STATUS_QUEUED, STATUS_RUNNING) == STATUS_RUNNING
    assert transition(STATUS_RUNNING, STATUS_TERMINATED) == STATUS_TERMINATED

def test_invalid_transition_raises():
    with pytest.raises(ValueError):
        transition(STATUS_TERMINATED, STATUS_RUNNING)

def test_exit_code_zero_with_result_is_end_turn():
    assert stop_reason_for_exit(0, has_result=True) == "end_turn"

def test_exit_nonzero_with_error_is_error():
    assert stop_reason_for_exit(1, has_error=True) == "retries_exhausted"

def test_signal_killed_is_cancelled():
    assert stop_reason_for_exit(-15, has_result=False) == "interrupted"

def test_daemon_restart_marker():
    assert stop_reason_for_exit(None, daemon_restart=True) == "daemon_restart"

def test_classify_exit_zero_with_result_is_terminated():
    assert classify_exit(0, has_result=True) == STATUS_TERMINATED

def test_classify_exit_signal_is_cancelled():
    assert classify_exit(-15) == STATUS_CANCELLED

def test_classify_exit_timeout_is_incomplete():
    assert classify_exit(0, timed_out=True) == STATUS_INCOMPLETE

def test_classify_exit_daemon_restart_is_error():
    assert classify_exit(None, daemon_restart=True) == STATUS_ERROR

def test_classify_exit_nonzero_with_error_is_error():
    assert classify_exit(1, has_error=True) == STATUS_ERROR
