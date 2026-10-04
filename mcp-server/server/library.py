"""Read-only views over the PocketBase library, shaped for an LLM caller.

A "crate" is an album (that is what the Crates tab shows). Tags live on
albums and artists, so a track carries the union of both.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from .pb import PocketBase, any_of, chunks, q

TRACK_EXPAND = "artist,album"


def track_view(t: dict[str, Any]) -> dict[str, Any]:
    """A library track in the shape every tool returns."""
    exp = t.get("expand") or {}
    artist = exp.get("artist") or {}
    album = exp.get("album") or {}
    ms = t.get("duration_ms") or 0
    return {
        "id": t["id"],
        "title": t.get("title", ""),
        "artist": artist.get("name", ""),
        "album": album.get("title", ""),
        "album_id": t.get("album") or None,
        "duration_s": round(ms / 1000) if ms else None,
        "play_count": t.get("play_count") or 0,
        "mbid": t.get("mbid") or None,
    }


def album_view(a: dict[str, Any], tag_names: dict[str, str] | None = None) -> dict[str, Any]:
    exp = a.get("expand") or {}
    view = {
        "id": a["id"],
        "title": a.get("title", ""),
        "artist": (exp.get("artist") or {}).get("name", ""),
        "release_year": a.get("release_year") or None,
        "play_count": a.get("play_count") or 0,
        "track_count": a.get("track_count") or 0,
    }
    if tag_names is not None:
        view["tags"] = [tag_names[t] for t in a.get("tag_relations") or [] if t in tag_names]
    return view


class Library:
    def __init__(self, pb: PocketBase):
        self.pb = pb

    async def tracks_by_ids(self, ids: list[str]) -> dict[str, dict[str, Any]]:
        """Library tracks (raw records, artist/album expanded) keyed by id."""
        return await self.pb.get_by_ids("tracks", ids, expand=TRACK_EXPAND)

    # -- crates (albums) ----------------------------------------------------

    async def list_crates(
        self, query: str | None, sort: str, limit: int, offset: int
    ) -> dict[str, Any]:
        sort_field = {
            "most_played": "-play_count",
            "least_played": "play_count",
            "title": "title",
            "newest_release": "-release_year",
            "recently_added": "-created",
        }.get(sort, "-play_count")
        filt = None
        if query:
            filt = f"(title~{q(query)} || artist.name~{q(query)})"
        limit = max(1, min(limit, 200))
        page = offset // limit + 1
        res = await self.pb.get_list(
            "albums", page=page, per_page=limit, filter=filt, sort=sort_field, expand="artist"
        )
        return {
            "total": res.get("totalItems", 0),
            "offset": (page - 1) * limit,
            "crates": [album_view(a) for a in res.get("items", [])],
        }

    async def get_crate_tracks(self, crate_id: str) -> dict[str, Any]:
        albums = await self.pb.get_by_ids("albums", [crate_id], expand="artist")
        album = albums.get(crate_id)
        if not album:
            raise ValueError(f"No crate (album) with id {crate_id!r}")
        # No track numbers are stored; import order follows the Last.fm tracklist.
        tracks = await self.pb.get_all(
            "tracks", filter=f"album={q(crate_id)}", sort="created", expand=TRACK_EXPAND
        )
        tags = await self._tag_names(album.get("tag_relations") or [])
        return {
            "crate": album_view(album, tags),
            "tracks": [track_view(t) for t in tracks],
        }

    # -- tags ---------------------------------------------------------------

    async def list_tags(self, limit: int) -> list[dict[str, Any]]:
        res = await self.pb.get_list("tags", per_page=max(1, min(limit, 500)), sort="-usage_count")
        return [
            {"id": t["id"], "name": t["name"], "slug": t.get("slug"), "usage_count": t.get("usage_count") or 0}
            for t in res.get("items", [])
        ]

    async def _tag_names(self, ids: list[str]) -> dict[str, str]:
        if not ids:
            return {}
        recs = await self.pb.get_by_ids("tags", ids)
        return {i: r["name"] for i, r in recs.items()}

    async def _resolve_tags(self, tags: list[str]) -> tuple[dict[str, str], list[str]]:
        """Tag names/slugs/ids -> {tag_id: name}, plus the ones not found."""
        found: dict[str, str] = {}
        missing: list[str] = []
        for raw in tags:
            t = raw.strip()
            if not t:
                continue
            res = await self.pb.get_list(
                "tags", per_page=1, skip_total=True,
                filter=f"(name={q(t)} || slug={q(t.lower().replace(' ', '-'))} || id={q(t)})",
            )
            items = res.get("items", [])
            if not items:  # PocketBase "=" is case-sensitive; fall back to a like-match
                res = await self.pb.get_list(
                    "tags", per_page=5, skip_total=True, filter=f"name~{q(t)}", sort="-usage_count"
                )
                items = [i for i in res.get("items", []) if i["name"].lower() == t.lower()]
            if items:
                found[items[0]["id"]] = items[0]["name"]
            else:
                missing.append(raw)
        return found, missing

    async def get_tagged_tracks(self, tags: list[str], match_all: bool, limit: int) -> dict[str, Any]:
        tag_ids, missing = await self._resolve_tags(tags)
        if not tag_ids:
            return {"tags": [], "unknown_tags": missing, "tracks": []}
        if match_all and missing:
            return {"tags": list(tag_ids.values()), "unknown_tags": missing, "tracks": []}

        ids = list(tag_ids)
        tag_filter = "(" + " || ".join(f"tag_relations~{q(i)}" for i in ids) + ")"
        albums, artists = await asyncio.gather(
            self.pb.get_all("albums", filter=tag_filter, fields="id,tag_relations,artist"),
            self.pb.get_all("artists", filter=tag_filter, fields="id,tag_relations"),
        )
        album_tags = {a["id"]: set(a.get("tag_relations") or []) for a in albums}
        artist_tags = {a["id"]: set(a.get("tag_relations") or []) for a in artists}

        tracks: dict[str, dict[str, Any]] = {}
        for field, keys in (("album", list(album_tags)), ("artist", list(artist_tags))):
            for chunk in chunks(keys):
                for t in await self.pb.get_all("tracks", filter=any_of(field, chunk), expand=TRACK_EXPAND):
                    tracks[t["id"]] = t

        wanted = set(ids)
        out = []
        for t in tracks.values():
            have = album_tags.get(t.get("album") or "", set()) | artist_tags.get(t.get("artist") or "", set())
            # An album outside the album query still contributes its own tags.
            have |= set(((t.get("expand") or {}).get("album") or {}).get("tag_relations") or [])
            have |= set(((t.get("expand") or {}).get("artist") or {}).get("tag_relations") or [])
            hits = wanted & have
            if (match_all and hits == wanted) or (not match_all and hits):
                view = track_view(t)
                view["matched_tags"] = sorted(tag_ids[h] for h in hits)
                out.append(view)
        out.sort(key=lambda v: (-len(v["matched_tags"]), -v["play_count"]))
        return {
            "tags": list(tag_ids.values()),
            "unknown_tags": missing,
            "total": len(out),
            "tracks": out[: max(1, min(limit, 500))],
        }

    # -- search -------------------------------------------------------------

    async def search(self, query: str, limit: int) -> list[dict[str, Any]]:
        qq = q(query.strip())
        res = await self.pb.get_list(
            "tracks",
            per_page=max(1, min(limit, 200)),
            filter=f"(title~{qq} || artist.name~{qq} || album.title~{qq})",
            sort="-play_count",
            expand=TRACK_EXPAND,
            skip_total=True,
        )
        return [track_view(t) for t in res.get("items", [])]

    # -- recent discoveries -------------------------------------------------

    async def recent_discoveries(self, days: int, limit: int) -> dict[str, Any]:
        """Tracks whose first-ever scrobble falls in the last `days` days, newest first."""
        days = max(1, min(days, 3650))
        limit = max(1, min(limit, 200))
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S.000Z")

        window = await self.pb.get_all(
            "scrobbles",
            cap=10000,
            filter=f"scrobbled_at>={q(cutoff)} && track!=\"\"",
            sort="scrobbled_at",
            fields="track,scrobbled_at",
        )
        first_seen: dict[str, str] = {}
        for s in window:
            first_seen.setdefault(s["track"], s["scrobbled_at"])
        candidates = sorted(first_seen, key=lambda t: first_seen[t], reverse=True)

        sem = asyncio.Semaphore(8)

        async def heard_before(track_id: str) -> bool:
            async with sem:
                res = await self.pb.get_list(
                    "scrobbles", per_page=1, skip_total=True, fields="id",
                    filter=f"track={q(track_id)} && scrobbled_at<{q(cutoff)}",
                )
                return bool(res.get("items"))

        new_ids: list[str] = []
        for batch in chunks(candidates, 24):
            flags = await asyncio.gather(*(heard_before(t) for t in batch))
            new_ids.extend(t for t, old in zip(batch, flags) if not old)
            if len(new_ids) >= limit:
                break
        new_ids = new_ids[:limit]

        recs = await self.tracks_by_ids(new_ids)
        out = []
        for tid in new_ids:
            if tid in recs:
                view = track_view(recs[tid])
                view["first_played"] = first_seen[tid]
                out.append(view)
        return {"days": days, "tracks": out}
