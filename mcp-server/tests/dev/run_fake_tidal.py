"""Serve the real app (OAuth, PocketBase, HTTP) with an in-memory fake TIDAL,
for exercising the playlist tools in MCP Inspector without a TIDAL account.
Uses the same env vars as the real server. Local testing only.

    ENV_FILE=test.env python -m tests.dev.run_fake_tidal
"""

import uvicorn

from server.app import build_http_app, build_server
from server.config import load_settings
from server.library import Library
from server.matcher import Matcher
from server.oauth import OwnerOAuthProvider
from server.pb import PocketBase
from tests.fakes import FakeTidal, cand

CATALOGUE = {
    "live forever": [
        cand("1001", "Live Forever (Live at Knebworth)", "Oasis", "Knebworth 1996", 291),
        cand("1002", "Live Forever", "Oasis", "Definitely Maybe (Remastered)", 277, version="Remastered"),
    ],
    "supersonic": [cand("1003", "Supersonic", "Oasis", "Definitely Maybe", 283)],
    "slide away": [cand("1004", "Slide Away", "Oasis", "Definitely Maybe", 392)],
    "alison": [cand("1005", "Alison", "Slowdive", "Souvlaki", 231)],
    "myth": [cand("1006", "Myth (Sped Up)", "Beach House", "Myth (Sped Up)", 205, version="Sped Up")],
    # "When the Sun Hits" deliberately absent: shows a miss
}


def main() -> None:
    s = load_settings()
    pb = PocketBase(s.pb_url, s.pb_email, s.pb_password)
    tidal = FakeTidal(search=CATALOGUE)
    provider = OwnerOAuthProvider(
        client_id=s.oauth_client_id, client_secret=s.oauth_client_secret, redirect_uris=s.oauth_redirect_uris,
        owner_password=s.owner_password, resource_url=s.mcp_url, issuer_url=s.public_base_url,
        store_path=s.oauth_store_file,
    )
    mcp = build_server(s, library=Library(pb), tidal=tidal, matcher=Matcher(tidal, pb, None), auth_provider=provider)
    uvicorn.run(build_http_app(s, mcp), host=s.host, port=s.port)


if __name__ == "__main__":
    main()
