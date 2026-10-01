"""TIDAL access behind a small interface, so tidalapi can be swapped for the
official API later by writing one new class.

tidalapi is synchronous; calls run in worker threads.
"""

from __future__ import annotations

import json
import logging
import os
import random
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Protocol, TypeVar

import anyio
import requests
import tidalapi
from tidalapi.exceptions import AuthenticationError, ObjectNotFound, TooManyRequests

from .matching import Candidate

log = logging.getLogger(__name__)
T = TypeVar("T")

ADD_BATCH = 50
MAX_RETRIES = 5


class TidalAuthError(RuntimeError):
    """The stored TIDAL session is missing or dead."""

    def __init__(self, detail: str = ""):
        super().__init__(
            "TIDAL session is not valid"
            + (f" ({detail})" if detail else "")
            + ". Re-run the one-time login on the server: "
            "`docker compose run --rm nostalge-mcp python -m server login`."
        )


class TidalError(RuntimeError):
    pass


@dataclass
class PlaylistInfo:
    id: str
    name: str
    num_tracks: int
    url: str
    description: str = ""


class TidalBackend(Protocol):
    async def search_tracks(self, query: str, limit: int = 10) -> list[Candidate]: ...
    async def tracks_by_isrc(self, isrc: str) -> list[Candidate]: ...
    async def create_playlist(self, name: str, description: str) -> PlaylistInfo: ...
    async def get_own_playlist(self, playlist_id: str) -> PlaylistInfo: ...
    async def add_tracks(self, playlist_id: str, tidal_ids: list[str]) -> int: ...
    async def list_playlists(self) -> list[PlaylistInfo]: ...


def with_backoff(fn: Callable[[], T], *, what: str, sleep: Callable[[float], None] = time.sleep) -> T:
    """Run `fn`, retrying TIDAL rate limits (429) and transient 5xx with jittered backoff."""
    for attempt in range(MAX_RETRIES):
        try:
            return fn()
        except TooManyRequests as e:
            wait = e.retry_after if e.retry_after and e.retry_after > 0 else 2 ** (attempt + 1)
        except requests.HTTPError as e:
            status = e.response.status_code if e.response is not None else 0
            if status == 401:
                raise TidalAuthError("TIDAL rejected the access token") from e
            if status not in (429, 500, 502, 503, 504):
                raise TidalError(f"TIDAL {what} failed: HTTP {status}") from e
            wait = 2 ** (attempt + 1)
        except requests.ConnectionError as e:
            wait = 2 ** (attempt + 1)
            if attempt == MAX_RETRIES - 1:
                raise TidalError(f"TIDAL unreachable during {what}") from e
        if attempt == MAX_RETRIES - 1:
            break
        wait = min(wait, 30) + random.uniform(0, 0.5)
        log.warning("TIDAL %s rate-limited/failed; retrying in %.1fs (attempt %d)", what, wait, attempt + 1)
        sleep(wait)
    raise TidalError(f"TIDAL {what} still rate-limited after {MAX_RETRIES} attempts; try again in a minute")


def to_candidate(track: Any, *, via_isrc: bool = False) -> Candidate:
    artists = tuple(a.name for a in (getattr(track, "artists", None) or []) if getattr(a, "name", None))
    if not artists and getattr(track, "artist", None) is not None:
        artists = (track.artist.name,)
    album = getattr(track, "album", None)
    return Candidate(
        tidal_id=str(track.id),
        title=track.name or "",
        artists=artists,
        album=(album.name if album is not None and getattr(album, "name", None) else "") or "",
        duration_s=getattr(track, "duration", None),
        version=getattr(track, "version", None),
        isrc=getattr(track, "isrc", None),
        available=bool(getattr(track, "available", True)),
        via_isrc=via_isrc,
    )


def _playlist_info(p: Any) -> PlaylistInfo:
    return PlaylistInfo(
        id=str(p.id),
        name=p.name or "",
        num_tracks=int(getattr(p, "num_tracks", 0) or 0),
        url=f"https://tidal.com/browse/playlist/{p.id}",
        description=getattr(p, "description", "") or "",
    )


class TidalapiBackend:
    def __init__(self, session_file: Path):
        self.session_file = session_file
        self._session: tidalapi.Session | None = None
        self._lock = threading.Lock()
        self._saved_token: str | None = None

    # -- session ------------------------------------------------------------

    def _load(self) -> tidalapi.Session:
        if not self.session_file.is_file():
            raise TidalAuthError("no saved session")
        session = tidalapi.Session()
        try:
            ok = session.load_session_from_file(self.session_file)
        except (AuthenticationError, requests.HTTPError) as e:
            raise TidalAuthError("refresh token rejected") from e
        if not ok or not session.check_login():
            raise TidalAuthError("saved session no longer accepted")
        log.info("TIDAL session loaded (country %s)", session.country_code)
        return session

    def _persist_if_refreshed(self, session: tidalapi.Session) -> None:
        """tidalapi refreshes expired access tokens in-flight; keep the file current."""
        if session.access_token and session.access_token != self._saved_token:
            save_session(session, self.session_file)
            self._saved_token = session.access_token

    def _call(self, fn: Callable[[tidalapi.Session], T], what: str) -> T:
        with self._lock:
            if self._session is None:
                self._session = self._load()
                self._saved_token = self._session.access_token
            session = self._session
        try:
            result = with_backoff(lambda: fn(session), what=what)
        except AuthenticationError as e:
            self._session = None
            raise TidalAuthError("token refresh failed") from e
        except TidalAuthError:
            self._session = None
            raise
        self._persist_if_refreshed(session)
        return result

    async def _run(self, fn: Callable[[tidalapi.Session], T], what: str) -> T:
        return await anyio.to_thread.run_sync(lambda: self._call(fn, what))

    # -- catalogue ----------------------------------------------------------

    async def search_tracks(self, query: str, limit: int = 10) -> list[Candidate]:
        def go(s: tidalapi.Session) -> list[Candidate]:
            res = s.search(query, models=[tidalapi.Track], limit=limit)
            return [to_candidate(t) for t in res.get("tracks", [])]

        return await self._run(go, "search")

    async def tracks_by_isrc(self, isrc: str) -> list[Candidate]:
        def go(s: tidalapi.Session) -> list[Candidate]:
            try:
                return [to_candidate(t, via_isrc=True) for t in s.get_tracks_by_isrc(isrc)]
            except (ObjectNotFound, tidalapi.exceptions.InvalidISRC):
                return []

        return await self._run(go, "ISRC lookup")

    # -- playlists ----------------------------------------------------------

    async def create_playlist(self, name: str, description: str) -> PlaylistInfo:
        return await self._run(lambda s: _playlist_info(s.user.create_playlist(name, description)), "create playlist")

    async def get_own_playlist(self, playlist_id: str) -> PlaylistInfo:
        def go(s: tidalapi.Session) -> PlaylistInfo:
            try:
                p = s.playlist(playlist_id)
            except ObjectNotFound as e:
                raise TidalError(f"No TIDAL playlist with id {playlist_id!r}") from e
            # tidalapi returns a UserPlaylist only when the logged-in user created it
            if not isinstance(p, tidalapi.UserPlaylist):
                raise TidalError("That playlist is not one of yours, so it can't be edited")
            return _playlist_info(p)

        return await self._run(go, "get playlist")

    async def add_tracks(self, playlist_id: str, tidal_ids: list[str]) -> int:
        added = 0
        for i in range(0, len(tidal_ids), ADD_BATCH):
            batch = tidal_ids[i : i + ADD_BATCH]

            def go(s: tidalapi.Session, batch: list[str] = batch) -> int:
                p = s.playlist(playlist_id)  # fresh object: fresh etag + track count
                return len(p.add(batch, allow_duplicates=False, limit=len(batch)) or [])

            added += await self._run(go, "add tracks")
        return added

    async def list_playlists(self) -> list[PlaylistInfo]:
        return await self._run(lambda s: [_playlist_info(p) for p in s.user.playlists()], "list playlists")


def save_session(session: tidalapi.Session, path: Path) -> None:
    """Write the session atomically with owner-only permissions."""
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "token_type": {"data": session.token_type},
        "access_token": {"data": session.access_token},
        "refresh_token": {"data": session.refresh_token},
        "is_pkce": {"data": session.is_pkce},
    }
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def interactive_login(session_file: Path) -> None:
    """Device login: prints a link, waits for approval, saves the session."""
    session = tidalapi.Session()
    login, future = session.login_oauth()
    print(f"\nOpen https://{login.verification_uri_complete} and approve this device.")
    print(f"The code expires in {login.expires_in} seconds. Waiting...\n")
    future.result()
    if not session.check_login():
        raise SystemExit("TIDAL login did not complete.")
    save_session(session, session_file)
    print(f"Logged in to TIDAL as user {session.user.id}. Session saved to {session_file}.")
