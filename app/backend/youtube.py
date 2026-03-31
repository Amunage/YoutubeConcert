from __future__ import annotations

import subprocess
from pathlib import Path
from urllib.parse import urlparse


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
