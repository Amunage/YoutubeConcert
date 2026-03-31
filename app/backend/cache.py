from __future__ import annotations

import os
import time
from pathlib import Path

from .state import (
    ACTIVE_TRACK_IDS,
    CACHE_DIR,
    CACHE_PRUNE_TARGET_RATIO,
    MAX_CACHE_AGE_HOURS,
    MAX_CACHE_BYTES,
    TRACKS,
)


def touch_path(path: Path) -> None:
    now = time.time()
    try:
        path.touch(exist_ok=True)
        path.chmod(path.stat().st_mode)
    except OSError:
        pass

    try:
        if path.exists():
            path.touch()
    except OSError:
        pass

    try:
        if path.parent.exists():
            os.utime(path.parent, (now, now))
    except OSError:
        pass

    try:
        if path.exists():
            os.utime(path, (now, now))
    except OSError:
        pass


def mark_track_used(file_path: Path) -> None:
    touch_path(file_path)


def get_cache_size_bytes() -> int:
    total = 0
    for file_path in CACHE_DIR.rglob("*"):
        if file_path.is_file():
            try:
                total += file_path.stat().st_size
            except OSError:
                continue
    return total


def delete_cache_dir(cache_dir: Path) -> None:
    try:
        for child in cache_dir.iterdir():
            if child.is_file():
                child.unlink(missing_ok=True)
            elif child.is_dir():
                delete_cache_dir(child)
        cache_dir.rmdir()
    except OSError:
        return


def collect_cache_entries() -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    for cache_dir in CACHE_DIR.iterdir():
        if not cache_dir.is_dir():
            continue

        total_size = 0
        newest_atime = 0.0
        newest_mtime = 0.0
        track_id = cache_dir.name

        for child in cache_dir.rglob("*"):
            if not child.is_file():
                continue
            try:
                stat = child.stat()
            except OSError:
                continue
            total_size += stat.st_size
            newest_atime = max(newest_atime, stat.st_atime)
            newest_mtime = max(newest_mtime, stat.st_mtime)

        entries.append(
            {
                "track_id": track_id,
                "path": cache_dir,
                "size": total_size,
                "atime": newest_atime,
                "mtime": newest_mtime,
                "active": track_id in ACTIVE_TRACK_IDS,
            }
        )
    return entries


def prune_cache(max_age_hours: int = MAX_CACHE_AGE_HOURS, max_cache_bytes: int = MAX_CACHE_BYTES) -> None:
    cutoff = time.time() - max_age_hours * 3600

    for entry in collect_cache_entries():
        cache_dir = entry["path"]
        track_id = str(entry["track_id"])
        last_touch = max(float(entry["atime"]), float(entry["mtime"]))
        if entry["active"]:
            continue
        if last_touch and last_touch < cutoff:
            delete_cache_dir(cache_dir)
            TRACKS.pop(track_id, None)

    total_size = get_cache_size_bytes()
    if total_size <= max_cache_bytes:
        return

    target_cache_bytes = min(
        max_cache_bytes,
        max(0, int(max_cache_bytes * CACHE_PRUNE_TARGET_RATIO)),
    )
    entries = sorted(
        collect_cache_entries(),
        key=lambda item: max(float(item["atime"]), float(item["mtime"])),
    )

    for entry in entries:
        if total_size <= target_cache_bytes:
            break
        if entry["active"]:
            continue

        cache_dir = entry["path"]
        track_id = str(entry["track_id"])
        size = int(entry["size"])
        delete_cache_dir(cache_dir)
        TRACKS.pop(track_id, None)
        total_size = max(0, total_size - size)
