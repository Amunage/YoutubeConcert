from __future__ import annotations

import json

from .youtube import run_yt_dlp_resolve


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
        raise RuntimeError("?ъ깮紐⑸줉 ?뺣낫瑜??쎌? 紐삵뻽?듬땲??") from error

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
        raise RuntimeError("?ъ깮 媛?ν븳 ?좏뒠釉???ぉ??李얠? 紐삵뻽?듬땲??")

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
        raise RuntimeError("?ъ깮紐⑸줉 怨??뺣낫瑜??쎌? 紐삵뻽?듬땲??") from error

    raw_entries = data.get("entries")
    if isinstance(raw_entries, list):
        for item in raw_entries:
            entry = build_playlist_entry(item)
            if entry:
                return entry

    single_entry = build_playlist_entry(data)
    if single_entry:
        return single_entry

    raise RuntimeError("?대떦 ?쒖꽌??怨≪쓣 李얠? 紐삵뻽?듬땲??")
