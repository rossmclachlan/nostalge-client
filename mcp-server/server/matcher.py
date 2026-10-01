"""Match library tracks to TIDAL: cache -> ISRC (via MusicBrainz) -> search."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Protocol

from .library import track_view
from .matching import Candidate, LibraryTrack, Score, best_match, search_queries
from .tidal import TidalAuthError, TidalBackend

log = logging.getLogger(__name__)

MAX_TRACKS_PER_CALL = 500
CONCURRENCY = 4


class MatchStore(Protocol):
    async def get_matches(self, track_ids: list[str]) -> dict[str, dict[str, Any]]: ...
    async def upsert_match(self, record: dict[str, Any]) -> None: ...


class IsrcSource(Protocol):
    async def isrcs(self, recording_mbid: str) -> list[str]: ...


class Matcher:
    def __init__(
        self,
        tidal: TidalBackend,
        store: MatchStore,
        isrc_source: IsrcSource | None,
        *,
        min_confidence: float = 0.80,
    ):
        self.tidal = tidal
        self.store = store
        self.isrc_source = isrc_source
        self.min_confidence = min_confidence

    async def match_records(self, ordered_ids: list[str], records: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        """One result per requested id, in request order (duplicates dropped)."""
        ids = list(dict.fromkeys(ordered_ids))
        if len(ids) > MAX_TRACKS_PER_CALL:
            raise ValueError(f"At most {MAX_TRACKS_PER_CALL} tracks per call (got {len(ids)})")

        try:
            cached = await self.store.get_matches([i for i in ids if i in records])
        except Exception as e:  # the cache is an optimisation, never a blocker
            log.warning("tidal_matches cache unavailable: %s", e)
            cached = {}

        sem = asyncio.Semaphore(CONCURRENCY)

        async def one(track_id: str) -> dict[str, Any]:
            rec = records.get(track_id)
            if rec is None:
                return {"track_id": track_id, "matched": False, "reason": "not in your library"}
            view = track_view(rec)
            hit = cached.get(track_id)
            if hit and float(hit.get("confidence", 0)) >= self.min_confidence:
                return {
                    "track_id": track_id,
                    "library": _brief(view),
                    "matched": True,
                    "tidal_id": hit["tidal_id"],
                    "confidence": hit["confidence"],
                    "method": "cache",
                    "tidal": {
                        "title": hit.get("matched_title", ""),
                        "artist": hit.get("matched_artist", ""),
                        "album": hit.get("matched_album", ""),
                    },
                }
            async with sem:
                return await self._match_one(view)

        return list(await asyncio.gather(*(one(i) for i in ids)))

    async def _match_one(self, view: dict[str, Any]) -> dict[str, Any]:
        track = LibraryTrack(
            id=view["id"],
            title=view["title"],
            artist=view["artist"],
            album=view["album"],
            duration_s=view["duration_s"],
            mbid=view["mbid"],
        )
        best: Score | None = None
        method = "search"

        # 1. ISRC via the recording MBID, when we have one
        if track.mbid and self.isrc_source is not None:
            for isrc in (await self.isrc_source.isrcs(track.mbid))[:3]:
                cands = await self.tidal.tracks_by_isrc(isrc)
                s = best_match(track, cands)
                if s and (best is None or s.confidence > best.confidence):
                    best, method = s, "isrc"
                if best and best.confidence >= self.min_confidence:
                    break

        # 2. Text search, most specific query first
        if best is None or best.confidence < self.min_confidence:
            pool: list[Candidate] = []
            for query in search_queries(track):
                pool.extend(await self.tidal.search_tracks(query, limit=10))
                s = best_match(track, pool)
                if s and (best is None or s.confidence > best.confidence):
                    best, method = s, "search"
                if best and best.confidence >= self.min_confidence:
                    break

        result: dict[str, Any] = {"track_id": track.id, "library": _brief(view)}
        if best is None:
            return {**result, "matched": False, "reason": "no results on TIDAL"}

        c = best.candidate
        found = {
            "tidal_id": c.tidal_id,
            "confidence": best.confidence,
            "tidal": {
                "title": c.title + (f" ({c.version})" if c.version else ""),
                "artist": ", ".join(c.artists),
                "album": c.album,
            },
        }
        if best.confidence < self.min_confidence:
            why = "; ".join(best.notes) or "names only partly match"
            return {
                **result,
                "matched": False,
                "reason": f"no confident match (best {best.confidence:.2f}: {why})",
                "best_candidate": found,
            }

        await self._remember(track.id, best, method)
        return {**result, "matched": True, "method": method, **found, **({"notes": best.notes} if best.notes else {})}

    async def _remember(self, track_id: str, best: Score, method: str) -> None:
        c = best.candidate
        try:
            await self.store.upsert_match(
                {
                    "library_track": track_id,
                    "tidal_id": c.tidal_id,
                    "confidence": best.confidence,
                    "method": method,
                    "matched_title": c.title + (f" ({c.version})" if c.version else ""),
                    "matched_artist": ", ".join(c.artists),
                    "matched_album": c.album,
                    "matched_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.000Z"),
                }
            )
        except TidalAuthError:
            raise
        except Exception as e:
            log.warning("could not cache match for %s: %s", track_id, e)


def _brief(view: dict[str, Any]) -> dict[str, Any]:
    return {"title": view["title"], "artist": view["artist"], "album": view["album"]}


def summarize(results: list[dict[str, Any]]) -> dict[str, Any]:
    matched = [r for r in results if r.get("matched")]
    misses = [r for r in results if not r.get("matched")]
    return {"matched_count": len(matched), "miss_count": len(misses), "matches": matched, "misses": misses}
