from __future__ import annotations

from typing import TypedDict


class TrackInfo(TypedDict):
    id: str
    title: str
    filename: str
    path: str


class PlaylistEntry(TypedDict):
    id: str
    title: str
    url: str
