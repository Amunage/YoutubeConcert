from __future__ import annotations

from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATE_PATH = BASE_DIR / "templates" / "index.html"
STATIC_DIR = BASE_DIR / "static"
STATIC_AUDIO_DIR = STATIC_DIR / "audio"
STATIC_PLAYER_DIR = STATIC_DIR / "player"


def resolve_script_path(*candidates: Path) -> Path:
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"Unable to locate script file. Tried: {', '.join(str(path) for path in candidates)}")


AUDIO_PRESETS_SCRIPT_PATH = resolve_script_path(STATIC_AUDIO_DIR / "presets.js")
AUDIO_EFFECTS_SCRIPT_PATH = resolve_script_path(STATIC_AUDIO_DIR / "effects.js")
AUDIO_OUTPUT_SCRIPT_PATH = resolve_script_path(STATIC_AUDIO_DIR / "output.js")
AUDIO_BUSES_SCRIPT_PATH = resolve_script_path(STATIC_AUDIO_DIR / "buses.js")
AUDIO_LAYERS_SCRIPT_PATH = resolve_script_path(STATIC_AUDIO_DIR / "layers.js")
AUDIO_ENGINE_SCRIPT_PATH = resolve_script_path(STATIC_AUDIO_DIR / "engine.js")
PLAYER_STATE_SCRIPT_PATH = resolve_script_path(
    STATIC_PLAYER_DIR / "state.js",
    STATIC_PLAYER_DIR / "tate.js",
)
PLAYER_DISPLAY_SCRIPT_PATH = resolve_script_path(STATIC_PLAYER_DIR / "display.js")
PLAYER_MEDIA_SCRIPT_PATH = resolve_script_path(STATIC_PLAYER_DIR / "media.js")
PLAYER_API_SCRIPT_PATH = resolve_script_path(STATIC_PLAYER_DIR / "api.js")
PLAYER_PLAYLIST_SCRIPT_PATH = resolve_script_path(STATIC_PLAYER_DIR / "playlist.js")
PLAYER_PLAYBACK_SCRIPT_PATH = resolve_script_path(STATIC_PLAYER_DIR / "playback.js")
PLAYER_CONTROLS_SCRIPT_PATH = resolve_script_path(STATIC_PLAYER_DIR / "controls.js")
