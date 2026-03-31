from __future__ import annotations

import json
import subprocess
from pathlib import Path
from urllib.parse import urlparse

from .models import PlaylistEntry


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
    return subprocess.run(command, capture_output=True, text=True, check=False)


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
    return subprocess.run(command, capture_output=True, text=True, check=False)


def build_playlist_entry(item: dict[str, object]) -> PlaylistEntry | None:
    if not isinstance(item, dict):
        return None

    video_id = str(item.get("id") or "").strip()
    title = str(item.get("title") or "").strip() or "Untitled"
    webpage_url = str(item.get("webpage_url") or "").strip()

    if not webpage_url and video_id:
        webpage_url = f"https://www.youtube.com/watch?v={video_id}"

    if not webpage_url or "youtu" not in webpage_url:
        return None

    return {"id": video_id or webpage_url, "title": title, "url": webpage_url}


def parse_resolve_output(stdout: str) -> dict[str, object]:
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("Could not read playlist information.") from error

    entries: list[PlaylistEntry] = []
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
        raise RuntimeError("No playable YouTube entries were found.")

    playlist_count = int(data.get("playlist_count") or data.get("n_entries") or len(entries) or 1)
    return {
        "title": str(data.get("title") or entries[0]["title"] or "Playlist"),
        "playlist_count": playlist_count,
        "entries": entries,
        "first_entry": entries[0],
        "first_entry_index": 0,
        "is_playlist": playlist_count > 1,
    }


def resolve_input_url(url: str) -> dict[str, object]:
    result = run_yt_dlp_resolve(url)
    if result.returncode != 0:
        stderr = result.stderr.strip() or result.stdout.strip() or "yt-dlp resolve failed"
        raise RuntimeError(stderr)
    return parse_resolve_output(result.stdout)


def resolve_playlist_entry(url: str, index: int) -> PlaylistEntry:
    result = run_yt_dlp_resolve(url, playlist_item=index)
    if result.returncode != 0:
        stderr = result.stderr.strip() or result.stdout.strip() or "yt-dlp resolve failed"
        raise RuntimeError(stderr)

    resolved = parse_resolve_output(result.stdout)
    return resolved["entries"][0]
