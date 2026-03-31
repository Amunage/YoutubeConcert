from __future__ import annotations

import json

from .assets import (
    AUDIO_BUSES_SCRIPT_PATH,
    AUDIO_EFFECTS_SCRIPT_PATH,
    AUDIO_ENGINE_SCRIPT_PATH,
    AUDIO_LAYERS_SCRIPT_PATH,
    AUDIO_OUTPUT_SCRIPT_PATH,
    AUDIO_PRESETS_SCRIPT_PATH,
    PLAYER_API_SCRIPT_PATH,
    PLAYER_CONTROLS_SCRIPT_PATH,
    PLAYER_DISPLAY_SCRIPT_PATH,
    PLAYER_MEDIA_SCRIPT_PATH,
    PLAYER_PLAYBACK_SCRIPT_PATH,
    PLAYER_PLAYLIST_SCRIPT_PATH,
    PLAYER_STATE_SCRIPT_PATH,
    TEMPLATE_PATH,
)


def render_app_html(config: dict[str, str | bool]) -> bytes:
    html = TEMPLATE_PATH.read_text(encoding="utf-8")
    audio_presets_js = AUDIO_PRESETS_SCRIPT_PATH.read_text(encoding="utf-8")
    audio_effects_js = AUDIO_EFFECTS_SCRIPT_PATH.read_text(encoding="utf-8")
    audio_output_js = AUDIO_OUTPUT_SCRIPT_PATH.read_text(encoding="utf-8")
    audio_buses_js = AUDIO_BUSES_SCRIPT_PATH.read_text(encoding="utf-8")
    audio_layers_js = AUDIO_LAYERS_SCRIPT_PATH.read_text(encoding="utf-8")
    audio_engine_js = AUDIO_ENGINE_SCRIPT_PATH.read_text(encoding="utf-8")
    player_state_js = PLAYER_STATE_SCRIPT_PATH.read_text(encoding="utf-8")
    player_state_js = player_state_js.replace("__APP_CONFIG__", json.dumps(config, ensure_ascii=False))
    player_display_js = PLAYER_DISPLAY_SCRIPT_PATH.read_text(encoding="utf-8")
    player_media_js = PLAYER_MEDIA_SCRIPT_PATH.read_text(encoding="utf-8")
    player_api_js = PLAYER_API_SCRIPT_PATH.read_text(encoding="utf-8")
    player_playlist_js = PLAYER_PLAYLIST_SCRIPT_PATH.read_text(encoding="utf-8")
    player_playback_js = PLAYER_PLAYBACK_SCRIPT_PATH.read_text(encoding="utf-8")
    player_controls_js = PLAYER_CONTROLS_SCRIPT_PATH.read_text(encoding="utf-8")
    html = html.replace("__AUDIO_PRESETS_JS__", audio_presets_js)
    html = html.replace("__AUDIO_EFFECTS_JS__", audio_effects_js)
    html = html.replace("__AUDIO_OUTPUT_JS__", audio_output_js)
    html = html.replace("__AUDIO_BUSES_JS__", audio_buses_js)
    html = html.replace("__AUDIO_LAYERS_JS__", audio_layers_js)
    html = html.replace("__AUDIO_ENGINE_JS__", audio_engine_js)
    html = html.replace("__PLAYER_STATE_JS__", player_state_js)
    html = html.replace("__PLAYER_UI_JS__", player_display_js)
    html = html.replace("__PLAYER_MEDIA_JS__", player_media_js)
    html = html.replace("__PLAYER_API_JS__", player_api_js)
    html = html.replace("__PLAYER_PLAYLIST_JS__", player_playlist_js)
    html = html.replace("__PLAYER_PLAYBACK_JS__", player_playback_js)
    html = html.replace("__PLAYER_CONTROLS_JS__", player_controls_js)
    return html.encode("utf-8")
