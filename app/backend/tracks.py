from __future__ import annotations

import hashlib
import re
import time
from pathlib import Path

from .cache import mark_track_used, prune_cache
from .state import (
    ACTIVE_TRACK_IDS,
    CACHE_DIR,
    DOWNLOAD_LOCK,
    TRACK_LAST_USED,
    TRACK_METADATA_MAX_IDLE_HOURS,
    TRACKS,
    TrackRecord,
)
from .youtube import run_yt_dlp


def touch_track_metadata(track_id: str) -> None:
    if not track_id:
        return
    TRACK_LAST_USED[track_id] = time.time()


def evict_idle_track_metadata(max_idle_hours: int = TRACK_METADATA_MAX_IDLE_HOURS) -> None:
    if max_idle_hours <= 0 or not TRACK_LAST_USED:
        return

    cutoff = time.time() - max_idle_hours * 3600
    for track_id, last_used in list(TRACK_LAST_USED.items()):
        if track_id in ACTIVE_TRACK_IDS:
            continue
        if last_used >= cutoff:
            continue
        TRACK_LAST_USED.pop(track_id, None)
        TRACKS.pop(track_id, None)


def prepare_track(url: str) -> TrackRecord:
    cache_key = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]

    with DOWNLOAD_LOCK:
        prune_cache()
        evict_idle_track_metadata()
        existing = TRACKS.get(cache_key)
        if existing and Path(existing["path"]).exists():
            print(f"[cache] {existing['title']} | {url}")
            mark_track_used(Path(existing["path"]))
            touch_track_metadata(cache_key)
            return existing

        ACTIVE_TRACK_IDS.add(cache_key)
        work_dir = CACHE_DIR / cache_key
        work_dir.mkdir(parents=True, exist_ok=True)
        target_template = work_dir / "%(title).180B [%(id)s].%(ext)s"

        try:
            result = run_yt_dlp(url, target_template)
            if result.returncode != 0:
                stderr = result.stderr.strip() or result.stdout.strip() or "yt-dlp failed"
                print(f"[download failed] {url} | {stderr.splitlines()[-1]}")
                raise RuntimeError(stderr)

            candidates = sorted(file_path for file_path in work_dir.iterdir() if file_path.is_file())
            if not candidates:
                print(f"[download failed] {url} | no audio file found")
                raise RuntimeError("?ㅼ슫濡쒕뱶???ㅻ뵒???뚯씪??李얠? 紐삵뻽?듬땲??")

            audio_path = candidates[-1]
            title = re.sub(r"\s+\[[^\]]+\]$", "", audio_path.stem).strip() or "Untitled"

            track = {
                "id": cache_key,
                "title": title,
                "filename": audio_path.name,
                "path": str(audio_path),
            }
            TRACKS[cache_key] = track
            touch_track_metadata(cache_key)
            mark_track_used(audio_path)
            print(f"[download] {title} | {url}")
            prune_cache()
            evict_idle_track_metadata()
            return track
        finally:
            ACTIVE_TRACK_IDS.discard(cache_key)


def get_track(track_id: str) -> TrackRecord | None:
    track = TRACKS.get(track_id)
    if track:
        touch_track_metadata(track_id)
    return track


def read_track_bytes(track_id: str) -> tuple[Path, bytes] | None:
    evict_idle_track_metadata()
    track = TRACKS.get(track_id)
    if not track:
        return None

    file_path = Path(track["path"])
    if not file_path.exists():
        TRACK_LAST_USED.pop(track_id, None)
        TRACKS.pop(track_id, None)
        return None

    ACTIVE_TRACK_IDS.add(track_id)
    try:
        touch_track_metadata(track_id)
        mark_track_used(file_path)
        body = file_path.read_bytes()
        return file_path, body
    finally:
        ACTIVE_TRACK_IDS.discard(track_id)


def get_track_path(track_id: str) -> Path | None:
    evict_idle_track_metadata()
    track = TRACKS.get(track_id)
    if not track:
        return None

    file_path = Path(track["path"])
    if not file_path.exists():
        TRACK_LAST_USED.pop(track_id, None)
        TRACKS.pop(track_id, None)
        return None

    touch_track_metadata(track_id)
    mark_track_used(file_path)
    return file_path
