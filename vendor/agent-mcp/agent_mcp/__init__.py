"""agent-mcp 共享常量。"""

# 版本单一来源（v3.0 起）：SERVER_VERSION（mcp_server.py）、install.py 摘要、
# pyproject.toml dynamic version 均从这里取值，禁止再各自硬编码。
# PEP 440 规范格式：3.0.0a1 = v3.0 里程碑1；后续 3.0.0b1 / 3.0.0rc1 / 3.0.0。
__version__ = "3.0.0a1"

# session 不匹配错误的触发短语：daemon 错误文案与 MCP 层检测共用一个来源，
# 避免任一侧改写后另一侧静默失效（echo 空转复现）。
SESSION_MISMATCH_MARK = "does not belong to session"
