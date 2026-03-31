from __future__ import annotations

import argparse

from ..backend import prune_cache
from ..runtime import ThreadingHTTPServer, open_browser_tab
from .handlers import AppHandler


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
