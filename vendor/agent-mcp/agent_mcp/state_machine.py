from __future__ import annotations

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_TERMINATED = "terminated"
STATUS_ERROR = "error"
STATUS_CANCELLED = "cancelled"
STATUS_INCOMPLETE = "incomplete"
STATUS_NEEDS_ADVISOR = "needs_advisor"

TERMINAL = frozenset({STATUS_TERMINATED, STATUS_ERROR, STATUS_CANCELLED,
                      STATUS_INCOMPLETE, STATUS_NEEDS_ADVISOR})

_TRANSITIONS = {
    STATUS_QUEUED: {STATUS_RUNNING, STATUS_ERROR, STATUS_CANCELLED},
    STATUS_RUNNING: {STATUS_TERMINATED, STATUS_ERROR, STATUS_CANCELLED,
                     STATUS_INCOMPLETE, STATUS_NEEDS_ADVISOR},
    STATUS_NEEDS_ADVISOR: {STATUS_RUNNING, STATUS_CANCELLED},
}

def transition(current: str, target: str) -> str:
    allowed = _TRANSITIONS.get(current)
    if allowed is None or target not in allowed:
        raise ValueError(f"invalid transition: {current} -> {target}")
    return target

def stop_reason_for_exit(exit_code: int | None, *, has_result: bool = False,
                         has_error: bool = False, daemon_restart: bool = False,
                         timed_out: bool = False) -> str:
    if daemon_restart:
        return "daemon_restart"
    if timed_out:
        return "timeout"
    if exit_code is None:
        return "unknown"
    if exit_code == 0 and has_result:
        return "end_turn"
    if exit_code != 0 and has_error:
        return "retries_exhausted"
    if exit_code < 0:
        return "interrupted"
    if exit_code != 0:
        return "error_exit"
    return "no_result"

def classify_exit(exit_code: int | None, *, has_result: bool = False,
                  has_error: bool = False, daemon_restart: bool = False,
                  timed_out: bool = False) -> str:
    reason = stop_reason_for_exit(exit_code, has_result=has_result, has_error=has_error,
                                  daemon_restart=daemon_restart, timed_out=timed_out)
    if reason == "end_turn":
        return STATUS_TERMINATED
    if reason in ("interrupted",):
        return STATUS_CANCELLED
    if reason in ("timeout",):
        return STATUS_INCOMPLETE
    return STATUS_ERROR
