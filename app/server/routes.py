from __future__ import annotations

import argparse
import http.server
import json
import mimetypes

from app.core.runtime import ThreadingHTTPServer, open_browser_tab
from app.core.shutdown import request_shutdown
from app.media.cache import prune_cache
from app.media.service import ACTIVE_TRACK_IDS, ADMIN_TOKEN, TRACKS, prepare_track, read_track_bytes
from app.media.youtube import is_probably_youtube, resolve_input_url, resolve_playlist_entry
from app.server.render import render_app_html
from app.server.responses import send_json
from app.shared.constants import HTML_CONTENT_TYPE
from app.shared.utils import with_access_hint


class AppHandler(http.server.BaseHTTPRequestHandler):
    server_version = "YouTubeConcert/1.0"

    def is_local_host_request(self) -> bool:
        host = (self.headers.get("Host") or "").split(":", 1)[0].lower()
        return host in {"127.0.0.1", "localhost", "::1"}

    def render_html(self) -> bytes:
        config = {
            "canShutdown": self.is_local_host_request(),
            "adminToken": ADMIN_TOKEN if self.is_local_host_request() else "",
        }
        return render_app_html(config)

    def do_GET(self) -> None:
        if self.path in {"/", "/index.html"}:
            body = self.render_html()
            self.send_response(200)
            self.send_header("Content-Type", HTML_CONTENT_TYPE)
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
                send_json(self, 403, {"error": "Shutdown is not allowed."})
                return
            send_json(self, 200, {"ok": "shutting down"})
            request_shutdown(self.server)
            return

        if self.path not in {"/api/prepare", "/api/resolve", "/api/playlist-entry"}:
            self.send_error(404, "Not Found")
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        payload = self.rfile.read(content_length)

        try:
            data = json.loads(payload.decode("utf-8"))
        except json.JSONDecodeError:
            send_json(self, 400, {"error": "Invalid JSON request."})
            return

        url = str(data.get("url", "")).strip()
        if not url:
            send_json(self, 400, {"error": "YouTube URL is empty."})
            return
        if not is_probably_youtube(url):
            send_json(self, 400, {"error": "Invalid YouTube URL format."})
            return

        if self.path == "/api/resolve":
            try:
                resolved = resolve_input_url(url)
            except RuntimeError as error:
                send_json(self, 500, {"error": with_access_hint(f"Input analysis failed: {error}")})
                return

            send_json(
                self,
                200,
                {
                    "title": str(resolved["title"]),
                    "playlistCount": int(resolved["playlist_count"]),
                    "entries": list(resolved["entries"]),
                    "firstEntry": dict(resolved["first_entry"]),
                    "firstEntryIndex": int(resolved["first_entry_index"]),
                    "isPlaylist": bool(resolved["is_playlist"]),
                },
            )
            return

        if self.path == "/api/playlist-entry":
            raw_index = data.get("index")
            try:
                item_index = int(raw_index)
            except (TypeError, ValueError):
                send_json(self, 400, {"error": "Invalid playlist item number."})
                return
            if item_index < 1:
                send_json(self, 400, {"error": "Playlist item number must be 1 or greater."})
                return

            try:
                entry = resolve_playlist_entry(url, item_index)
            except RuntimeError as error:
                send_json(self, 500, {"error": with_access_hint(f"Playlist item lookup failed: {error}")})
                return

            send_json(self, 200, {"entry": entry})
            return

        try:
            track = prepare_track(url)
        except RuntimeError as error:
            send_json(self, 500, {"error": with_access_hint(f"Audio preparation failed: {error}")})
            return

        send_json(
            self,
            200,
            {"id": track["id"], "title": track["title"], "filename": track["filename"]},
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

    prune_cache(TRACKS, ACTIVE_TRACK_IDS)

    app_url = f"http://{args.host}:{args.port}"

    with ThreadingHTTPServer((args.host, args.port), AppHandler) as server:
        print(f"YouTube Concert is running at {app_url}")
        print("Paste a YouTube URL in the browser, then the app will fetch audio and layer it locally.")
        open_browser_tab(app_url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\\nServer stopped.")
