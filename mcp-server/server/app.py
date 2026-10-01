"""The MCP server: tool definitions + HTTP app (Streamable HTTP + OAuth).

No `from __future__ import annotations` here: the SDK builds each tool's input
schema from real annotation objects, and string annotations break that.
"""

import functools
import inspect
import logging
import time
from contextlib import asynccontextmanager
from dataclasses import asdict
from typing import Annotated, Any, Awaitable, Callable
from urllib.parse import urlparse

from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions, RevocationOptions
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import Field
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .config import Settings
from .library import Library
from .matcher import Matcher, summarize
from .musicbrainz import MusicBrainz
from .oauth import OwnerOAuthProvider, TokenAuthMethodMiddleware
from .pb import PocketBase, PocketBaseError
from .tidal import TidalapiBackend, TidalAuthError, TidalBackend, TidalError

log = logging.getLogger("nostalge_mcp")

INSTRUCTIONS = """\
Tools for the owner's personal music library (a Last.fm-derived record collection) and their TIDAL account.
Library tools are read-only and return library track ids. A "crate" is an album.
To build a TIDAL playlist: gather library track ids, call create_playlist with dry_run=true, show the user the
matches and misses, and only call again with dry_run=false once they agree. Never invent track ids."""


def logged(fn: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
    """Log each tool call (name, arguments, outcome, duration). Never tokens:
    tool arguments are library ids, names and flags only."""

    @functools.wraps(fn)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        start = time.monotonic()
        shown = {k: (f"<{len(v)} ids>" if isinstance(v, list) and len(v) > 5 else v) for k, v in kwargs.items()}
        try:
            result = await fn(*args, **kwargs)
        except ToolError as e:
            log.info("tool %s %s -> error in %.1fs: %s", fn.__name__, shown, time.monotonic() - start, e)
            raise
        except (TidalAuthError, TidalError, PocketBaseError, ValueError) as e:
            log.info("tool %s %s -> error in %.1fs: %s", fn.__name__, shown, time.monotonic() - start, e)
            raise ToolError(str(e)) from e
        except Exception:
            log.exception("tool %s %s -> crashed", fn.__name__, shown)
            raise ToolError("Internal error; see the server log") from None
        log.info("tool %s %s -> ok in %.1fs", fn.__name__, shown, time.monotonic() - start)
        return result

    wrapper.__signature__ = inspect.signature(fn)  # type: ignore[attr-defined]
    return wrapper


TrackIds = Annotated[list[str], Field(description="Library track ids (from the library tools)", min_length=1, max_length=500)]


def build_server(
    settings: Settings,
    *,
    library: Library,
    tidal: TidalBackend,
    matcher: Matcher,
    auth_provider: OwnerOAuthProvider | None,
    lifespan: Any = None,
) -> MCPServer:
    auth = None
    if auth_provider is not None:
        auth = AuthSettings(
            issuer_url=settings.public_base_url,
            resource_server_url=settings.mcp_url,
            validate_token_resource=True,
            client_registration_options=ClientRegistrationOptions(enabled=False),
            revocation_options=RevocationOptions(enabled=True),
        )
    mcp = MCPServer(
        name="nostalge",
        title="Nostalge music library + TIDAL",
        instructions=INSTRUCTIONS,
        auth_server_provider=auth_provider,
        auth=auth,
        lifespan=lifespan,
    )

    # -- library (read-only) --------------------------------------------------

    @mcp.tool()
    @logged
    async def list_crates(
        query: Annotated[str | None, Field(description="Filter by album title or artist name")] = None,
        sort: Annotated[
            str, Field(description="most_played | least_played | title | newest_release | recently_added")
        ] = "most_played",
        limit: Annotated[int, Field(ge=1, le=200)] = 50,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> dict[str, Any]:
        """List crates (albums) in the library with artist, year and play count. Use get_crate_tracks for a tracklist."""
        return await library.list_crates(query, sort, limit, offset)

    @mcp.tool()
    @logged
    async def get_crate_tracks(crate_id: Annotated[str, Field(description="Crate (album) id")]) -> dict[str, Any]:
        """Get the tracks on one crate (album), with track ids for playlist tools."""
        return await library.get_crate_tracks(crate_id)

    @mcp.tool()
    @logged
    async def list_tags(limit: Annotated[int, Field(ge=1, le=500)] = 100) -> list[dict[str, Any]]:
        """List genre/mood/era tags in the library, most used first."""
        return await library.list_tags(limit)

    @mcp.tool()
    @logged
    async def get_tagged_tracks(
        tags: Annotated[list[str], Field(description="Tag names (case-insensitive)", min_length=1, max_length=10)],
        match_all: Annotated[bool, Field(description="true: tracks must have every tag; false: any tag")] = False,
        limit: Annotated[int, Field(ge=1, le=500)] = 100,
    ) -> dict[str, Any]:
        """Get tracks whose album or artist carries the given tags, most-matching then most-played first."""
        return await library.get_tagged_tracks(tags, match_all, limit)

    @mcp.tool()
    @logged
    async def search_library(
        query: Annotated[str, Field(min_length=1, description="Matches track title, artist or album")],
        limit: Annotated[int, Field(ge=1, le=200)] = 25,
    ) -> list[dict[str, Any]]:
        """Search library tracks by title, artist or album name."""
        return await library.search(query, limit)

    @mcp.tool()
    @logged
    async def get_recent_discoveries(
        limit: Annotated[int, Field(ge=1, le=200)] = 25,
        days: Annotated[int, Field(ge=1, le=3650, description="Look-back window")] = 30,
    ) -> dict[str, Any]:
        """Get tracks first played in the last N days (never scrobbled before), newest first."""
        return await library.recent_discoveries(days, limit)

    # -- TIDAL ------------------------------------------------------------

    async def _match(track_ids: list[str]) -> list[dict[str, Any]]:
        records = await library.tracks_by_ids(track_ids)
        return await matcher.match_records(track_ids, records)

    @mcp.tool()
    @logged
    async def match_tracks(track_ids: TrackIds) -> dict[str, Any]:
        """Find each library track on TIDAL. Returns tidal_id, confidence and matched title/artist/album, or why it missed. Read-only on TIDAL."""
        return summarize(await _match(track_ids))

    @mcp.tool()
    @logged
    async def create_playlist(
        name: Annotated[str, Field(min_length=1, max_length=200)],
        track_ids: TrackIds,
        description: Annotated[str, Field(max_length=500)] = "",
        dry_run: Annotated[bool, Field(description="true: only preview matches and misses; false: create it")] = True,
    ) -> dict[str, Any]:
        """Create a TIDAL playlist from library tracks, in the given order. dry_run=true (default) previews matches and misses without touching TIDAL; confirm with the user before dry_run=false."""
        summary = summarize(await _match(track_ids))
        if dry_run:
            return {"dry_run": True, "name": name, **summary}
        tidal_ids = list(dict.fromkeys(m["tidal_id"] for m in summary["matches"]))
        if not tidal_ids:
            raise ToolError("None of the tracks matched on TIDAL, so no playlist was created")
        playlist = await tidal.create_playlist(name, description)
        added = await tidal.add_tracks(playlist.id, tidal_ids)
        return {"dry_run": False, "playlist": asdict(playlist) | {"num_tracks": added}, "added": added, **summary}

    @mcp.tool()
    @logged
    async def add_to_playlist(
        playlist_id: Annotated[str, Field(description="TIDAL playlist id (from list_my_playlists)")],
        track_ids: TrackIds,
        dry_run: Annotated[bool, Field(description="true: only preview; false: add the tracks")] = True,
    ) -> dict[str, Any]:
        """Append library tracks to one of your TIDAL playlists (duplicates skipped). dry_run=true (default) previews only."""
        playlist = await tidal.get_own_playlist(playlist_id)
        summary = summarize(await _match(track_ids))
        if dry_run:
            return {"dry_run": True, "playlist": asdict(playlist), **summary}
        tidal_ids = list(dict.fromkeys(m["tidal_id"] for m in summary["matches"]))
        added = await tidal.add_tracks(playlist.id, tidal_ids) if tidal_ids else 0
        return {
            "dry_run": False,
            "playlist": asdict(playlist),
            "added": added,
            "skipped_as_duplicates": len(tidal_ids) - added,
            **summary,
        }

    @mcp.tool()
    @logged
    async def list_my_playlists() -> list[dict[str, Any]]:
        """List playlists you created on TIDAL (id, name, track count, link)."""
        return [asdict(p) for p in await tidal.list_playlists()]

    # -- plain HTTP routes ---------------------------------------------------

    @mcp.custom_route("/healthz", methods=["GET"])
    async def healthz(request: Request) -> Response:
        return JSONResponse({"status": "ok"})

    if auth_provider is not None:

        @mcp.custom_route("/consent", methods=["GET", "POST"])
        async def consent(request: Request) -> Response:
            return await auth_provider.consent(request)

    return mcp


def build_http_app(settings: Settings, mcp: MCPServer) -> Starlette:
    public_host = urlparse(settings.public_base_url).netloc
    app = mcp.streamable_http_app(
        stateless_http=True,
        json_response=True,
        host=settings.host,
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=[public_host, "localhost:*", "127.0.0.1:*", "nostalge-mcp:*"],
            allowed_origins=[
                settings.public_base_url,
                "https://claude.ai",
                "http://localhost:*",
                "http://127.0.0.1:*",
            ],
        ),
    )
    app.add_middleware(TokenAuthMethodMiddleware)
    return app


def create_app(settings: Settings) -> Starlette:
    pb = PocketBase(settings.pb_url, settings.pb_email, settings.pb_password)
    mb = MusicBrainz(settings.musicbrainz_contact) if settings.musicbrainz_lookup else None
    tidal = TidalapiBackend(settings.tidal_session_file)
    matcher = Matcher(tidal, pb, mb, min_confidence=settings.match_min_confidence)
    provider = OwnerOAuthProvider(
        client_id=settings.oauth_client_id,
        client_secret=settings.oauth_client_secret,
        redirect_uris=settings.oauth_redirect_uris,
        owner_password=settings.owner_password,
        resource_url=settings.mcp_url,
        issuer_url=settings.public_base_url,
        store_path=settings.oauth_store_file,
    )

    @asynccontextmanager
    async def lifespan(_server: Any):
        try:
            yield {}
        finally:
            await pb.aclose()
            if mb is not None:
                await mb.aclose()

    mcp = build_server(
        settings, library=Library(pb), tidal=tidal, matcher=matcher, auth_provider=provider, lifespan=lifespan
    )
    return build_http_app(settings, mcp)
