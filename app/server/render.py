from __future__ import annotations

import json

from app.core.config import AUDIO_DIR, SERVER_TEMPLATE_DIR, UI_DIR

TEMPLATE_PATH = SERVER_TEMPLATE_DIR / "index.html"
UI_STATE_PATH = UI_DIR / "state.js"
UI_SESSION_PATH = UI_DIR / "session.js"
UI_PLAYLIST_PATH = UI_DIR / "playlist.js"
UI_CONTROLS_PATH = UI_DIR / "controls.js"
AUDIO_EFFECTS_PATH = AUDIO_DIR / "effects.js"
AUDIO_PRESETS_PATH = AUDIO_DIR / "presets.js"
AUDIO_OUTPUT_PATH = AUDIO_DIR / "output.js"
AUDIO_BUSES_PATH = AUDIO_DIR / "buses.js"
AUDIO_LAYERS_PATH = AUDIO_DIR / "layers.js"
AUDIO_ENGINE_PATH = AUDIO_DIR / "engine.js"


def render_app_html(config: dict[str, str | bool]) -> bytes:
    html = TEMPLATE_PATH.read_text(encoding="utf-8")
    replacements = {
        "__APP_STATE_JS__": UI_STATE_PATH.read_text(encoding="utf-8").replace(
            "__APP_CONFIG__", json.dumps(config, ensure_ascii=False)
        ),
        "__UI_SESSION_JS__": UI_SESSION_PATH.read_text(encoding="utf-8"),
        "__UI_PLAYLIST_JS__": UI_PLAYLIST_PATH.read_text(encoding="utf-8"),
        "__AUDIO_PRESETS_JS__": AUDIO_PRESETS_PATH.read_text(encoding="utf-8"),
        "__AUDIO_EFFECTS_JS__": AUDIO_EFFECTS_PATH.read_text(encoding="utf-8"),
        "__AUDIO_OUTPUT_JS__": AUDIO_OUTPUT_PATH.read_text(encoding="utf-8"),
        "__AUDIO_BUSES_JS__": AUDIO_BUSES_PATH.read_text(encoding="utf-8"),
        "__AUDIO_LAYERS_JS__": AUDIO_LAYERS_PATH.read_text(encoding="utf-8"),
        "__AUDIO_ENGINE_JS__": AUDIO_ENGINE_PATH.read_text(encoding="utf-8"),
        "__UI_CONTROLS_JS__": UI_CONTROLS_PATH.read_text(encoding="utf-8"),
    }
    for placeholder, script in replacements.items():
        html = html.replace(placeholder, script)
    return html.encode("utf-8")
