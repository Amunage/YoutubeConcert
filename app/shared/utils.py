from __future__ import annotations


def with_access_hint(message: str) -> str:
    lowered = message.lower()
    if "music premium members" in lowered or "only available to music premium" in lowered:
        return "This video is available to Premium members only."
    return message
