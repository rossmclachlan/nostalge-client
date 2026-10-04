"""In-memory stand-ins for TIDAL, the match cache and MusicBrainz."""

from __future__ import annotations

from typing import Any

from server.matching import Candidate
from server.tidal import PlaylistInfo, TidalError


def cand(tidal_id: str, title: str, artist: str | tuple[str, ...], album: str = "", duration: int | None = None,
         version: str | None = None, isrc: str | None = None, available: bool = True) -> Candidate:
    artists = (artist,) if isinstance(artist, str) else artist
    return Candidate(tidal_id=tidal_id, title=title, artists=artists, album=album, duration_s=duration,
                     version=version, isrc=isrc, available=available)


class FakeTidal:
    """Search results keyed by query substring; ISRC results keyed by ISRC."""

    def __init__(self, search: dict[str, list[Candidate]] | None = None,
                 isrc: dict[str, list[Candidate]] | None = None):
        self.search_results = search or {}
        self.isrc_results = isrc or {}
        self.queries: list[str] = []
        self.playlists: dict[str, PlaylistInfo] = {}
        self.items: dict[str, list[str]] = {}
        self.foreign: set[str] = set()

    async def search_tracks(self, query: str, limit: int = 10) -> list[Candidate]:
        self.queries.append(query)
        out: list[Candidate] = []
        for key, cands in self.search_results.items():
            if key in query:
                out.extend(cands)
        return out[:limit]

    async def tracks_by_isrc(self, isrc: str) -> list[Candidate]:
        from dataclasses import replace

        return [replace(c, via_isrc=True) for c in self.isrc_results.get(isrc, [])]

    async def create_playlist(self, name: str, description: str) -> PlaylistInfo:
        pid = f"pl-{len(self.playlists) + 1}"
        self.playlists[pid] = PlaylistInfo(pid, name, 0, f"https://tidal.com/browse/playlist/{pid}", description)
        self.items[pid] = []
        return self.playlists[pid]

    async def get_own_playlist(self, playlist_id: str) -> PlaylistInfo:
        if playlist_id in self.foreign:
            raise TidalError("That playlist is not one of yours, so it can't be edited")
        if playlist_id not in self.playlists:
            raise TidalError(f"No TIDAL playlist with id {playlist_id!r}")
        return self.playlists[playlist_id]

    async def add_tracks(self, playlist_id: str, tidal_ids: list[str]) -> int:
        new = [t for t in tidal_ids if t not in self.items[playlist_id]]
        self.items[playlist_id].extend(new)
        return len(new)

    async def list_playlists(self) -> list[PlaylistInfo]:
        return list(self.playlists.values())


class FakeStore:
    def __init__(self, rows: dict[str, dict[str, Any]] | None = None):
        self.rows = rows or {}
        self.writes: list[dict[str, Any]] = []

    async def get_matches(self, track_ids: list[str]) -> dict[str, dict[str, Any]]:
        return {t: self.rows[t] for t in track_ids if t in self.rows}

    async def upsert_match(self, record: dict[str, Any]) -> None:
        self.writes.append(record)
        self.rows[record["library_track"]] = record


class FakeMusicBrainz:
    def __init__(self, isrcs: dict[str, list[str]]):
        self.map = isrcs
        self.calls: list[str] = []

    async def isrcs(self, mbid: str) -> list[str]:
        self.calls.append(mbid)
        return self.map.get(mbid, [])


def record(track_id: str, title: str, artist: str, album: str = "", duration_s: int | None = None,
           mbid: str | None = None) -> dict[str, Any]:
    """A PocketBase tracks record with artist/album expanded."""
    return {
        "id": track_id,
        "title": title,
        "album": f"al-{album}" if album else "",
        "duration_ms": duration_s * 1000 if duration_s else 0,
        "mbid": mbid or "",
        "play_count": 1,
        "expand": {"artist": {"name": artist}, **({"album": {"title": album}} if album else {})},
    }
