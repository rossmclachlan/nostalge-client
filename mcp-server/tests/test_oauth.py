"""OAuth end to end through the real HTTP app, as claude.ai would drive it."""

import base64
import hashlib
import secrets
from urllib.parse import parse_qs, urlparse

import pytest
from starlette.testclient import TestClient

from server.app import build_http_app, build_server
from server.config import CLAUDE_CALLBACK, Settings
from server.library import Library
from server.matcher import Matcher
from server.oauth import OwnerOAuthProvider
from server.pb import PocketBase
from tests.fakes import FakeStore, FakeTidal

BASE = "http://localhost:8000"
CLIENT_ID = "claude-connector"
SECRET = "s" * 40
PASSWORD = "correct horse battery"
ACCEPT = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


@pytest.fixture
def client(tmp_path):
    settings = Settings(
        pb_url="http://127.0.0.1:1", pb_email="x", pb_password="x", public_base_url=BASE,
        oauth_client_id=CLIENT_ID, oauth_client_secret=SECRET, owner_password=PASSWORD,
        oauth_redirect_uris=[CLAUDE_CALLBACK], data_dir=tmp_path,
    )
    provider = OwnerOAuthProvider(
        client_id=CLIENT_ID, client_secret=SECRET, redirect_uris=[CLAUDE_CALLBACK], owner_password=PASSWORD,
        resource_url=settings.mcp_url, issuer_url=BASE, store_path=tmp_path / "tokens.json",
    )
    tidal = FakeTidal()
    mcp = build_server(settings, library=Library(PocketBase(settings.pb_url, "x", "x")), tidal=tidal,
                       matcher=Matcher(tidal, FakeStore(), None), auth_provider=provider)
    with TestClient(build_http_app(settings, mcp), base_url=BASE, follow_redirects=False) as c:
        yield c


def pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def authorize(c: TestClient, challenge: str, redirect_uri: str = CLAUDE_CALLBACK):
    return c.get("/authorize", params={
        "response_type": "code", "client_id": CLIENT_ID, "redirect_uri": redirect_uri,
        "code_challenge": challenge, "code_challenge_method": "S256", "state": "st4te",
        "resource": f"{BASE}/mcp",
    })


def get_code(c: TestClient, challenge: str) -> str:
    r = authorize(c, challenge)
    assert r.status_code == 302
    consent = urlparse(r.headers["location"])
    assert consent.path == "/consent"
    txn = parse_qs(consent.query)["txn"][0]
    page = c.get("/consent", params={"txn": txn})
    assert page.status_code == 200 and "claude.ai" in page.text
    r = c.post("/consent", data={"txn": txn, "password": PASSWORD, "action": "allow"})
    assert r.status_code == 302
    back = urlparse(r.headers["location"])
    assert f"{back.scheme}://{back.netloc}{back.path}" == CLAUDE_CALLBACK
    qs = parse_qs(back.query)
    assert qs["state"] == ["st4te"]
    return qs["code"][0]


def tokens(c: TestClient) -> dict:
    verifier, challenge = pkce()
    code = get_code(c, challenge)
    r = c.post("/token", data={
        "grant_type": "authorization_code", "code": code, "redirect_uri": CLAUDE_CALLBACK,
        "code_verifier": verifier, "client_id": CLIENT_ID, "client_secret": SECRET,
        "resource": f"{BASE}/mcp",
    })
    assert r.status_code == 200, r.text
    return r.json()


def rpc(c: TestClient, method: str, params: dict | None = None, token: str | None = None):
    headers = dict(ACCEPT)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return c.post("/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})


INIT = {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "0"}}


def test_unauthenticated_mcp_gets_401_with_metadata_pointer(client):
    r = rpc(client, "initialize", INIT)
    assert r.status_code == 401
    assert 'resource_metadata="http://localhost:8000/.well-known/oauth-protected-resource/mcp"' in r.headers[
        "www-authenticate"]


def test_discovery_metadata(client):
    prm = client.get("/.well-known/oauth-protected-resource/mcp").json()
    assert prm["resource"] == f"{BASE}/mcp"
    assert prm["authorization_servers"] == [f"{BASE}"] or prm["authorization_servers"] == [f"{BASE}/"]
    asm = client.get("/.well-known/oauth-authorization-server").json()
    assert asm["code_challenge_methods_supported"] == ["S256"]
    assert "registration_endpoint" not in asm  # no dynamic registration
    assert client.post("/register", json={"redirect_uris": ["https://evil.example/cb"]}).status_code in (404, 405)


def test_full_flow_then_tools_list(client):
    tok = tokens(client)
    assert tok["token_type"].lower() == "bearer" and tok["refresh_token"]
    r = rpc(client, "initialize", INIT, tok["access_token"])
    assert r.status_code == 200, r.text
    r = rpc(client, "tools/list", {}, tok["access_token"])
    names = {t["name"] for t in r.json()["result"]["tools"]}
    assert names == {
        "list_crates", "get_crate_tracks", "list_tags", "get_tagged_tracks", "search_library",
        "get_recent_discoveries", "match_tracks", "create_playlist", "add_to_playlist", "list_my_playlists",
    }


def test_basic_client_auth_also_accepted_and_refresh_rotates(client):
    tok = tokens(client)
    basic = base64.b64encode(f"{CLIENT_ID}:{SECRET}".encode()).decode()
    r = client.post("/token", headers={"Authorization": f"Basic {basic}"},
                    data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"], "client_id": CLIENT_ID})
    assert r.status_code == 200, r.text
    new = r.json()
    assert new["refresh_token"] != tok["refresh_token"]
    # old refresh token is dead, and so is the access token it minted
    again = client.post("/token", data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"],
                                        "client_id": CLIENT_ID, "client_secret": SECRET})
    assert again.status_code == 400 and again.json()["error"] == "invalid_grant"
    assert rpc(client, "initialize", INIT, tok["access_token"]).status_code == 401
    assert rpc(client, "initialize", INIT, new["access_token"]).status_code == 200


def test_basic_auth_without_client_id_in_body(client):
    """RFC 6749 clients using HTTP Basic may omit client_id from the form (MCP Inspector does)."""
    verifier, challenge = pkce()
    code = get_code(client, challenge)
    basic = base64.b64encode(f"{CLIENT_ID}:{SECRET}".encode()).decode()
    r = client.post("/token", headers={"Authorization": f"Basic {basic}"}, data={
        "grant_type": "authorization_code", "code": code, "redirect_uri": CLAUDE_CALLBACK, "code_verifier": verifier})
    assert r.status_code == 200, r.text
    bad = base64.b64encode(f"{CLIENT_ID}:wrong".encode()).decode()
    r = client.post("/token", headers={"Authorization": f"Basic {bad}"},
                    data={"grant_type": "refresh_token", "refresh_token": r.json()["refresh_token"]})
    assert r.status_code == 401


def test_wrong_client_secret_rejected(client):
    verifier, challenge = pkce()
    code = get_code(client, challenge)
    r = client.post("/token", data={"grant_type": "authorization_code", "code": code, "redirect_uri": CLAUDE_CALLBACK,
                                    "code_verifier": verifier, "client_id": CLIENT_ID, "client_secret": "nope"})
    assert r.status_code == 401


def test_wrong_pkce_verifier_rejected(client):
    _, challenge = pkce()
    code = get_code(client, challenge)
    r = client.post("/token", data={"grant_type": "authorization_code", "code": code, "redirect_uri": CLAUDE_CALLBACK,
                                    "code_verifier": "x" * 50, "client_id": CLIENT_ID, "client_secret": SECRET})
    assert r.status_code == 400


def test_code_is_single_use(client):
    verifier, challenge = pkce()
    code = get_code(client, challenge)
    form = {"grant_type": "authorization_code", "code": code, "redirect_uri": CLAUDE_CALLBACK,
            "code_verifier": verifier, "client_id": CLIENT_ID, "client_secret": SECRET}
    assert client.post("/token", data=form).status_code == 200
    assert client.post("/token", data=form).status_code == 400


def test_unregistered_redirect_uri_is_refused_without_redirecting(client):
    _, challenge = pkce()
    r = authorize(client, challenge, redirect_uri="https://evil.example/cb")
    assert r.status_code == 400
    assert "evil.example" not in r.headers.get("location", "")


def test_unknown_client_refused(client):
    r = client.get("/authorize", params={"response_type": "code", "client_id": "someone-else",
                                         "redirect_uri": CLAUDE_CALLBACK, "code_challenge": "x" * 43,
                                         "code_challenge_method": "S256"})
    assert r.status_code == 400


def test_wrong_password_then_lockout(client):
    _, challenge = pkce()
    txn = parse_qs(urlparse(authorize(client, challenge).headers["location"]).query)["txn"][0]
    for _ in range(5):
        assert client.post("/consent", data={"txn": txn, "password": "guess", "action": "allow"}).status_code == 401
    r = client.post("/consent", data={"txn": txn, "password": PASSWORD, "action": "allow"})
    assert r.status_code == 429


def test_deny_redirects_with_access_denied(client):
    _, challenge = pkce()
    txn = parse_qs(urlparse(authorize(client, challenge).headers["location"]).query)["txn"][0]
    r = client.post("/consent", data={"txn": txn, "action": "deny"})
    assert r.status_code == 302 and "error=access_denied" in r.headers["location"]


def test_tokens_stored_hashed(client, tmp_path):
    tok = tokens(client)
    stored = (tmp_path / "tokens.json").read_text()
    assert tok["access_token"] not in stored and tok["refresh_token"] not in stored


def test_foreign_host_header_rejected(client):
    tok = tokens(client)
    r = client.post("/mcp", headers={**ACCEPT, "Authorization": f"Bearer {tok['access_token']}",
                                     "Host": "evil.example"},
                    json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": INIT})
    assert r.status_code == 421
