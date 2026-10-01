"""PocketBase REST client (v0.22 API) for a dedicated service user.

Reads anything the service user can see; the only write is the
`tidal_matches` cache (see `upsert_match`).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

log = logging.getLogger(__name__)

PER_PAGE = 200


class PocketBaseError(RuntimeError):
    pass


def q(value: str) -> str:
    """Quote a value for a PocketBase filter string."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def any_of(field: str, ids: list[str]) -> str:
    """`(field="a" || field="b")` for a chunk of ids."""
    return "(" + " || ".join(f"{field}={q(i)}" for i in ids) + ")"


def chunks(items: list[str], size: int = 40) -> list[list[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


class PocketBase:
    def __init__(self, base_url: str, email: str, password: str, *, timeout: float = 15.0):
        self._email = email
        self._password = password
        self._token: str | None = None
        self._auth_lock = asyncio.Lock()
        self._http = httpx.AsyncClient(base_url=base_url, timeout=timeout)

    async def aclose(self) -> None:
        await self._http.aclose()

    # -- auth ---------------------------------------------------------------

    async def _authenticate(self) -> None:
        resp = await self._http.post(
            "/api/collections/users/auth-with-password",
            json={"identity": self._email, "password": self._password},
        )
        if resp.status_code != 200:
            raise PocketBaseError(
                f"PocketBase login for the service user failed (HTTP {resp.status_code}). "
                "Check PB_EMAIL / PB_PASSWORD."
            )
        self._token = resp.json()["token"]

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        for attempt in range(2):
            if self._token is None:
                async with self._auth_lock:
                    if self._token is None:
                        await self._authenticate()
            headers = {"Authorization": self._token or ""}
            try:
                resp = await self._http.request(method, path, headers=headers, **kwargs)
            except httpx.HTTPError as e:
                raise PocketBaseError(f"PocketBase unreachable: {type(e).__name__}") from e
            if resp.status_code == 401 and attempt == 0:
                self._token = None  # expired: log in again once
                continue
            return resp
        return resp

    async def _json(self, method: str, path: str, **kwargs: Any) -> Any:
        resp = await self._request(method, path, **kwargs)
        if resp.status_code >= 400:
            detail = ""
            try:
                detail = resp.json().get("message", "")
            except ValueError:
                pass
            raise PocketBaseError(f"PocketBase {method} {path} failed: HTTP {resp.status_code} {detail}".strip())
        return resp.json()

    # -- reads --------------------------------------------------------------

    async def get_list(
        self,
        collection: str,
        *,
        page: int = 1,
        per_page: int = PER_PAGE,
        filter: str | None = None,
        sort: str | None = None,
        expand: str | None = None,
        fields: str | None = None,
        skip_total: bool = False,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "perPage": per_page}
        if filter:
            params["filter"] = filter
        if sort:
            params["sort"] = sort
        if expand:
            params["expand"] = expand
        if fields:
            params["fields"] = fields
        if skip_total:
            params["skipTotal"] = 1
        return await self._json("GET", f"/api/collections/{collection}/records", params=params)

    async def get_all(self, collection: str, *, cap: int = 5000, **kwargs: Any) -> list[dict[str, Any]]:
        """Page through a collection until exhausted or `cap` records."""
        out: list[dict[str, Any]] = []
        page = 1
        while len(out) < cap:
            res = await self.get_list(collection, page=page, skip_total=True, **kwargs)
            items = res.get("items", [])
            out.extend(items)
            if len(items) < kwargs.get("per_page", PER_PAGE):
                break
            page += 1
        return out[:cap]

    async def get_by_ids(
        self, collection: str, ids: list[str], *, expand: str | None = None
    ) -> dict[str, dict[str, Any]]:
        """Fetch records by id, chunked so filter strings stay short."""
        found: dict[str, dict[str, Any]] = {}
        unique = list(dict.fromkeys(ids))
        for chunk in chunks(unique):
            items = await self.get_all(collection, filter=any_of("id", chunk), expand=expand)
            found.update({r["id"]: r for r in items})
        return found

    # -- the one write: tidal_matches cache ---------------------------------

    async def get_matches(self, track_ids: list[str]) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        for chunk in chunks(list(dict.fromkeys(track_ids))):
            items = await self.get_all("tidal_matches", filter=any_of("library_track", chunk))
            out.update({r["library_track"]: r for r in items})
        return out

    async def upsert_match(self, record: dict[str, Any]) -> None:
        existing = await self.get_list(
            "tidal_matches", per_page=1, filter=f"library_track={q(record['library_track'])}", skip_total=True
        )
        items = existing.get("items", [])
        if items:
            await self._json("PATCH", f"/api/collections/tidal_matches/records/{items[0]['id']}", json=record)
        else:
            await self._json("POST", "/api/collections/tidal_matches/records", json=record)
