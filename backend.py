from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import urlparse


BASE_DIR = Path(__file__).resolve().parent
CACHE_DIR = BASE_DIR / "cache"
CACHE_DIR.mkdir(exist_ok=True)
MAX_CACHE_BYTES = 500 * 1024 * 1024
MAX_CACHE_AGE_HOURS = 24

DOWNLOAD_LOCK = threading.Lock()
TRACKS: dict[str, dict[str, str]] = {}
ACTIVE_TRACK_IDS: set[str] = set()
ADMIN_TOKEN = secrets.token_urlsafe(24)


def is_probably_youtube(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False

    return parsed.scheme in {"http", "https"} and "youtu" in parsed.netloc


def run_yt_dlp(url: str, target_template: Path) -> subprocess.CompletedProcess[str]:
    command = [
        "python",
        "-m",
        "yt_dlp",
        "--no-playlist",
        "--format",
        "bestaudio/best",
        "--output",
        str(target_template),
        url,
    ]
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
    )


def run_yt_dlp_resolve(url: str, playlist_item: int | None = None) -> subprocess.CompletedProcess[str]:
    command = [
        "python",
        "-m",
        "yt_dlp",
        "--dump-single-json",
        "--flat-playlist",
        "--no-warnings",
    ]
    if playlist_item is not None:
        command.extend(["--playlist-items", str(playlist_item)])
    command.append(url)
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
    )


def build_playlist_entry(item: dict[str, object]) -> dict[str, str] | None:
    if not isinstance(item, dict):
        return None

    video_id = str(item.get("id") or "").strip()
    title = str(item.get("title") or "").strip() or "Untitled"
    webpage_url = str(item.get("webpage_url") or "").strip()

    if not webpage_url and video_id:
        webpage_url = f"https://www.youtube.com/watch?v={video_id}"

    if not webpage_url or "youtu" not in webpage_url:
        return None

    return {
        "id": video_id or webpage_url,
        "title": title,
        "url": webpage_url,
    }


def resolve_input_url(url: str) -> dict[str, object]:
    result = run_yt_dlp_resolve(url)
    if result.returncode != 0:
        stderr = result.stderr.strip() or result.stdout.strip() or "yt-dlp resolve failed"
        raise RuntimeError(stderr)

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("재생목록 정보를 읽지 못했습니다.") from error

    entries: list[dict[str, str]] = []
    raw_entries = data.get("entries")
    if isinstance(raw_entries, list):
        for item in raw_entries:
            entry = build_playlist_entry(item)
            if entry:
                entries.append(entry)

    if not entries:
        single_entry = build_playlist_entry(data)
        if single_entry:
            entries.append(single_entry)

    if not entries:
        raise RuntimeError("재생 가능한 유튜브 항목을 찾지 못했습니다.")

    playlist_count = int(data.get("playlist_count") or data.get("n_entries") or len(entries) or 1)
    return {
        "title": str(data.get("title") or entries[0]["title"] or "Playlist"),
        "playlist_count": playlist_count,
        "entries": entries,
        "first_entry": entries[0],
        "first_entry_index": 0,
        "is_playlist": playlist_count > 1,
    }


def resolve_playlist_entry(url: str, index: int) -> dict[str, str]:
    result = run_yt_dlp_resolve(url, playlist_item=index)
    if result.returncode != 0:
        stderr = result.stderr.strip() or result.stdout.strip() or "yt-dlp resolve failed"
        raise RuntimeError(stderr)

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("재생목록 곡 정보를 읽지 못했습니다.") from error

    raw_entries = data.get("entries")
    if isinstance(raw_entries, list):
        for item in raw_entries:
            entry = build_playlist_entry(item)
            if entry:
                return entry

    single_entry = build_playlist_entry(data)
    if single_entry:
        return single_entry

    raise RuntimeError("해당 순서의 곡을 찾지 못했습니다.")


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

    for entry in sorted(collect_cache_entries(), key=lambda item: (float(item["atime"]), float(item["mtime"]))):
        if total_size <= max_cache_bytes:
            break
        if entry["active"]:
            continue

        cache_dir = entry["path"]
        track_id = str(entry["track_id"])
        size = int(entry["size"])
        delete_cache_dir(cache_dir)
        TRACKS.pop(track_id, None)
        total_size = max(0, total_size - size)


def prepare_track(url: str) -> dict[str, str]:
    cache_key = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]

    with DOWNLOAD_LOCK:
        prune_cache()
        existing = TRACKS.get(cache_key)
        if existing and Path(existing["path"]).exists():
            print(f"[cache] {existing['title']} | {url}")
            mark_track_used(Path(existing["path"]))
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
                raise RuntimeError("다운로드한 오디오 파일을 찾지 못했습니다.")

            audio_path = candidates[-1]
            title = re.sub(r"\s+\[[^\]]+\]$", "", audio_path.stem).strip() or "Untitled"

            track = {
                "id": cache_key,
                "title": title,
                "filename": audio_path.name,
                "path": str(audio_path),
            }
            TRACKS[cache_key] = track
            mark_track_used(audio_path)
            print(f"[download] {title} | {url}")
            prune_cache()
            return track
        finally:
            ACTIVE_TRACK_IDS.discard(cache_key)


def get_track(track_id: str) -> dict[str, str] | None:
    return TRACKS.get(track_id)


def read_track_bytes(track_id: str) -> tuple[Path, bytes] | None:
    track = TRACKS.get(track_id)
    if not track:
        return None

    file_path = Path(track["path"])
    if not file_path.exists():
        return None

    ACTIVE_TRACK_IDS.add(track_id)
    try:
        mark_track_used(file_path)
        body = file_path.read_bytes()
        return file_path, body
    finally:
        ACTIVE_TRACK_IDS.discard(track_id)
