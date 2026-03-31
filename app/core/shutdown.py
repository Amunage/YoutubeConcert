from __future__ import annotations

import threading


def request_shutdown(server: object) -> None:
    threading.Thread(target=server.shutdown, daemon=True).start()
