from __future__ import annotations

import http.server
import json
import mimetypes
import threading

from ..backend import (
    ADMIN_TOKEN,
    ACTIVE_TRACK_IDS,
    get_track_path,
    is_probably_youtube,
    prepare_track,
    resolve_input_url,
    resolve_playlist_entry,
)
from ..ui import render_app_html


class AppHandler(http.server.BaseHTTPRequestHandler):
    server_version = "YouTubeConcert/1.0"
    media_chunk_size = 1024 * 256

    @staticmethod
    def with_access_hint(message: str) -> str:
        lowered = message.lower()
        if "music premium members" in lowered or "only available to music premium" in lowered:
            return "이 영상은 프리미엄 전용입니다."
        return message

    def is_local_host_request(self) -> bool:
        host = (self.headers.get("Host") or "").split(":", 1)[0].lower()
        return host in {"127.0.0.1", "localhost", "::1"}

    def render_html(self) -> bytes:
        config = {
            "canShutdown": self.is_local_host_request(),
            "adminToken": ADMIN_TOKEN if self.is_local_host_request() else "",
        }
        return render_app_html(config)

    @staticmethod
    def is_client_disconnect_error(error: BaseException) -> bool:
        return isinstance(error, (BrokenPipeError, ConnectionAbortedError, ConnectionResetError))

    def write_response_body(self, body: bytes) -> bool:
        try:
            self.wfile.write(body)
            return True
        except OSError as error:
            if self.is_client_disconnect_error(error):
                return False
            raise

    def send_json(self, status: int, payload: dict[str, str]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.write_response_body(body)

    def do_GET(self) -> None:
        if self.path in {"/", "/index.html"}:
            body = self.render_html()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.write_response_body(body)
            return

        if self.path.startswith("/media/"):
            track_id = self.path.rsplit("/", 1)[-1]
            file_path = get_track_path(track_id)
            if not file_path:
                self.send_error(404, "Audio file missing")
                return

            mime_type, _ = mimetypes.guess_type(file_path.name)
            file_size = file_path.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type", mime_type or "application/octet-stream")
            self.send_header("Content-Length", str(file_size))
            self.end_headers()
            ACTIVE_TRACK_IDS.add(track_id)
            try:
                with file_path.open("rb") as audio_file:
                    while True:
                        chunk = audio_file.read(self.media_chunk_size)
                        if not chunk:
                            break
                        if not self.write_response_body(chunk):
                            break
            finally:
                ACTIVE_TRACK_IDS.discard(track_id)
            return

        self.send_error(404, "Not Found")

    def do_POST(self) -> None:
        if self.path == "/api/shutdown":
            admin_token = self.headers.get("X-Admin-Token", "")
            if admin_token != ADMIN_TOKEN:
                self.send_json(403, {"error": "종료 권한이 없습니다."})
                return
            self.send_json(200, {"ok": "shutting down"})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return

        if self.path not in {"/api/prepare", "/api/resolve", "/api/playlist-entry"}:
            self.send_error(404, "Not Found")
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        payload = self.rfile.read(content_length)

        try:
            data = json.loads(payload.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_json(400, {"error": "잘못된 JSON 요청입니다."})
            return

        url = str(data.get("url", "")).strip()
        if not url:
            self.send_json(400, {"error": "유튜브 주소가 비어 있습니다."})
            return
        if not is_probably_youtube(url):
            self.send_json(400, {"error": "유튜브 주소 형태가 올바르지 않습니다."})
            return

        if self.path == "/api/resolve":
            try:
                resolved = resolve_input_url(url)
            except RuntimeError as error:
                self.send_json(500, {"error": self.with_access_hint(f"입력 분석 실패: {error}")})
                return

            body = json.dumps(
                {
                    "title": str(resolved["title"]),
                    "playlistCount": int(resolved["playlist_count"]),
                    "entries": list(resolved["entries"]),
                    "firstEntry": dict(resolved["first_entry"]),
                    "firstEntryIndex": int(resolved["first_entry_index"]),
                    "isPlaylist": bool(resolved["is_playlist"]),
                },
                ensure_ascii=False,
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.write_response_body(body)
            return

        if self.path == "/api/playlist-entry":
            raw_index = data.get("index")
            try:
                item_index = int(raw_index)
            except (TypeError, ValueError):
                self.send_json(400, {"error": "재생목록 곡 번호가 잘못되었습니다."})
                return
            if item_index < 1:
                self.send_json(400, {"error": "재생목록 곡 번호는 1 이상이어야 합니다."})
                return

            try:
                entry = resolve_playlist_entry(url, item_index)
            except RuntimeError as error:
                self.send_json(500, {"error": self.with_access_hint(f"재생목록 곡 읽기 실패: {error}")})
                return

            body = json.dumps({"entry": entry}, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.write_response_body(body)
            return

        try:
            track = prepare_track(url)
        except RuntimeError as error:
            self.send_json(500, {"error": self.with_access_hint(f"오디오 준비 실패: {error}")})
            return

        self.send_json(
            200,
            {
                "id": track["id"],
                "title": track["title"],
                "filename": track["filename"],
            },
        )

    def log_message(self, format: str, *args) -> None:
        return
