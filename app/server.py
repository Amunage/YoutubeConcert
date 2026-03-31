from __future__ import annotations

import argparse
import http.server
import json
import mimetypes
import threading

from .backend import (
    ADMIN_TOKEN,
    is_probably_youtube,
    prepare_track,
    prune_cache,
    read_track_bytes,
    resolve_input_url,
    resolve_playlist_entry,
)
from .runtime import ThreadingHTTPServer, open_browser_tab
from .ui import render_app_html





class AppHandler(http.server.BaseHTTPRequestHandler):
    server_version = "YouTubeConcert/1.0"

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

    def send_json(self, status: int, payload: dict[str, str]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path in {"/", "/index.html"}:
            body = self.render_html()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if self.path.startswith("/media/"):
            track_id = self.path.rsplit("/", 1)[-1]
            payload = read_track_bytes(track_id)
            if not payload:
                self.send_error(404, "Audio file missing")
                return

            file_path, body = payload
            mime_type, _ = mimetypes.guess_type(file_path.name)
            self.send_response(200)
            self.send_header("Content-Type", mime_type or "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
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
            self.wfile.write(body)
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
            self.wfile.write(body)
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


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Serve a local app that downloads YouTube audio and layers it with time offsets."
    )
    parser.add_argument("--host", default="127.0.0.1", help="Host interface to bind to.")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind to.")
    args = parser.parse_args()

    prune_cache()

    app_url = f"http://{args.host}:{args.port}"

    with ThreadingHTTPServer((args.host, args.port), AppHandler) as server:
        print(f"YouTube Concert is running at {app_url}")
        print("Paste a YouTube URL in the browser, then the app will fetch audio and layer it locally.")
        open_browser_tab(app_url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\\nServer stopped.")


if __name__ == "__main__":
    main()
