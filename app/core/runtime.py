from __future__ import annotations

import socketserver
import threading
import webbrowser


class ThreadingHTTPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


def open_browser_tab(url: str) -> None:
    def _open() -> None:
        try:
            webbrowser.open_new_tab(url)
        except Exception:
            webbrowser.open(url)

    threading.Timer(0.8, _open).start()
