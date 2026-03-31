from __future__ import annotations

import json

from app.shared.constants import JSON_CONTENT_TYPE


def send_json(handler: object, status: int, payload: dict[str, object]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", JSON_CONTENT_TYPE)
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)
