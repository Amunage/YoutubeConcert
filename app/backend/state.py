from __future__ import annotations

import secrets
import threading
from pathlib import Path


TrackRecord = dict[str, str]

BASE_DIR = Path(__file__).resolve().parent.parent
CACHE_DIR = BASE_DIR / "cache"
CACHE_DIR.mkdir(exist_ok=True)

MAX_CACHE_BYTES = 500 * 1024 * 1024
MAX_CACHE_AGE_HOURS = 24
CACHE_PRUNE_TARGET_RATIO = 0.7
TRACK_METADATA_MAX_IDLE_HOURS = 6

DOWNLOAD_LOCK = threading.Lock()
TRACKS: dict[str, TrackRecord] = {}
TRACK_LAST_USED: dict[str, float] = {}
ACTIVE_TRACK_IDS: set[str] = set()
ADMIN_TOKEN = secrets.token_urlsafe(24)
