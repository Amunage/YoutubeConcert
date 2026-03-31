from __future__ import annotations

import socketserver


class ThreadingHTTPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
