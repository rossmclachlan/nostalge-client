"""Run the OAuth flow headlessly against a running server and print an access
token, for poking at it with MCP Inspector's CLI. Local testing only.

    python tests/dev/get_token.py http://localhost:8765 <client_id> <client_secret> <owner_password>
"""

import base64
import hashlib
import secrets
import sys
from urllib.parse import parse_qs, urlparse

import httpx

CALLBACK = "https://claude.ai/api/mcp/auth_callback"


def main(base: str, client_id: str, client_secret: str, password: str) -> None:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    http = httpx.Client(base_url=base, follow_redirects=False)
    r = http.get("/authorize", params={
        "response_type": "code", "client_id": client_id, "redirect_uri": CALLBACK, "state": "x",
        "code_challenge": challenge, "code_challenge_method": "S256", "resource": f"{base}/mcp",
    })
    txn = parse_qs(urlparse(r.headers["location"]).query)["txn"][0]
    r = http.post("/consent", data={"txn": txn, "password": password, "action": "allow"})
    code = parse_qs(urlparse(r.headers["location"]).query)["code"][0]
    r = http.post("/token", data={
        "grant_type": "authorization_code", "code": code, "redirect_uri": CALLBACK, "code_verifier": verifier,
        "client_id": client_id, "client_secret": client_secret, "resource": f"{base}/mcp",
    })
    r.raise_for_status()
    print(r.json()["access_token"])


if __name__ == "__main__":
    main(*sys.argv[1:5])
