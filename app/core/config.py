from __future__ import annotations

from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
APP_DIR = ROOT_DIR / "app"

SERVER_DIR = APP_DIR / "server"
SERVER_TEMPLATE_DIR = SERVER_DIR / "templates"

AUDIO_DIR = APP_DIR / "audio"
UI_DIR = APP_DIR / "ui"

CACHE_DIR = ROOT_DIR / "cache"
CACHE_DIR.mkdir(exist_ok=True)

MAX_CACHE_BYTES = 500 * 1024 * 1024
MAX_CACHE_AGE_HOURS = 24
CACHE_PRUNE_TARGET_RATIO = 0.7
