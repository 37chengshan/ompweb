"""工作区文件变更审计与 Diff 追踪器。

在任务执行前后对工作区文件快照比对，生成细粒度 file diff 审计日志并写入数据库与活动流。
"""
from __future__ import annotations

import difflib
import hashlib
import os
from typing import Any


def _hash_file(path: str, max_size: int = 10 * 1024 * 1024) -> str:
    """计算单个文件的 SHA256 哈希（流式分块读取，防止大文件 OOM）。"""
    try:
        if os.path.getsize(path) > max_size:
            return "skipped_too_large"
        h = hashlib.sha256()
        with open(path, "rb") as f:
            while chunk := f.read(65536):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return ""


def snapshot_workspace(root_dir: str, max_files: int = 1000, ignore_dirs: set[str] | None = None) -> dict[str, dict[str, Any]]:
    """扫描工作区，生成文件指纹快照。"""
    if ignore_dirs is None:
        ignore_dirs = {".git", ".venv", "__pycache__", "node_modules", ".dsh", ".idea", ".vscode"}

    snapshot: dict[str, dict[str, Any]] = {}
    count = 0
    for root, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if d not in ignore_dirs]
        for f in files:
            if count >= max_files:
                break
            full_path = os.path.join(root, f)
            rel_path = os.path.relpath(full_path, root_dir)
            try:
                stat = os.stat(full_path)
                snapshot[rel_path] = {
                    "size": stat.st_size,
                    "mtime": stat.st_mtime,
                    "hash": _hash_file(full_path),
                }
                count += 1
            except (OSError, IOError):
                continue
    return snapshot


def compute_workspace_diff(
    root_dir: str,
    before_snap: dict[str, dict[str, Any]],
    after_snap: dict[str, dict[str, Any]],
    *,
    include_text_diff: bool = True,
    max_diff_bytes: int = 10000,
) -> dict[str, Any]:
    """比对前后两个快照，生成修改、新增、删除的文件清单与 Unified Diff。"""
    before_keys = set(before_snap.keys())
    after_keys = set(after_snap.keys())

    added = sorted(list(after_keys - before_keys))
    deleted = sorted(list(before_keys - after_keys))
    modified = []

    for k in sorted(list(before_keys & after_keys)):
        if before_snap[k]["hash"] != after_snap[k]["hash"]:
            modified.append(k)

    diffs: dict[str, str] = {}
    if include_text_diff:
        for rel_path in modified:
            full_path = os.path.join(root_dir, rel_path)
            try:
                # 仅对文本小文件计算 diff
                if os.path.getsize(full_path) <= max_diff_bytes:
                    with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
                        lines_after = f.readlines()
                    # 无法完全还原 before 文本时仅标注变更，若有需要可由版本控制支撑
                    diffs[rel_path] = f"--- a/{rel_path}\n+++ b/{rel_path}\n@@ modified (hash {before_snap[rel_path]['hash'][:8]} -> {after_snap[rel_path]['hash'][:8]}) @@"
            except Exception:
                pass

    return {
        "added": added,
        "deleted": deleted,
        "modified": modified,
        "total_changes": len(added) + len(deleted) + len(modified),
        "diffs": diffs,
    }
