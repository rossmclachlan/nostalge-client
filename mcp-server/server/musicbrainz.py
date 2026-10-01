"""MusicBrainz recording MBID -> ISRCs. MusicBrainz allows 1 request/second."""

from __future__ import annotations

import asyncio
import logging
import time

import httpx

log = logging.getLogger(__name__)


class MusicBrainz:
    def __init__(self, contact: str, *, min_interval: float = 1.1):
        self._http = httpx.AsyncClient(
            base_url="https://musicbrainz.org/ws/2",
            timeout=10.0,
            headers={"User-Agent": f"nostalge-mcp/0.1 ( {contact} )", "Accept": "application/json"},
        )
        self._lock = asyncio.Lock()
        self._last = 0.0
        self._min_interval = min_interval
        self._cache: dict[str, list[str]] = {}

    async def aclose(self) -> None:
        await self._http.aclose()

    async def isrcs(self, recording_mbid: str) -> list[str]:
        """ISRCs for a recording; [] when unknown or MusicBrainz is unavailable."""
        if recording_mbid in self._cache:
            return self._cache[recording_mbid]
        async with self._lock:
            wait = self._min_interval - (time.monotonic() - self._last)
            if wait > 0:
                await asyncio.sleep(wait)
            try:
                resp = await self._http.get(f"/recording/{recording_mbid}", params={"inc": "isrcs", "fmt": "json"})
            except httpx.HTTPError as e:
                log.warning("MusicBrainz unreachable: %s", type(e).__name__)
                return []
            finally:
                self._last = time.monotonic()
        if resp.status_code != 200:
            # 404: the MBID is an album/track id rather than a recording; 503: throttled.
            result: list[str] = []
        else:
            result = [i for i in resp.json().get("isrcs", []) if isinstance(i, str)]
        self._cache[recording_mbid] = result
        return result
