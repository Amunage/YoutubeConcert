from __future__ import annotations

import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
TEMPLATE_PATH = BASE_DIR / "templates" / "index.html"
AUDIO_PRESETS_SCRIPT_PATH = BASE_DIR / "static" / "audio_presets.js"
AUDIO_ENGINE_SCRIPT_PATH = BASE_DIR / "static" / "audio_engine.js"
AUDIO_SCRIPT_PATH = BASE_DIR / "static" / "client_audio.js"


def render_app_html(config: dict[str, str | bool]) -> bytes:
    html = TEMPLATE_PATH.read_text(encoding="utf-8")
    audio_presets_js = AUDIO_PRESETS_SCRIPT_PATH.read_text(encoding="utf-8")
    audio_engine_js = AUDIO_ENGINE_SCRIPT_PATH.read_text(encoding="utf-8")
    audio_js = AUDIO_SCRIPT_PATH.read_text(encoding="utf-8")
    audio_js = audio_js.replace("__APP_CONFIG__", json.dumps(config, ensure_ascii=False))
    html = html.replace("__AUDIO_PRESETS_JS__", audio_presets_js)
    html = html.replace("__AUDIO_ENGINE_JS__", audio_engine_js)
    html = html.replace("__CLIENT_AUDIO_JS__", audio_js)
    return html.encode("utf-8")
