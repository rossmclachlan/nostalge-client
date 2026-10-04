"""A deliberately small OAuth 2.1 authorization server for one owner.

- One pre-registered confidential client (id + secret from env). No dynamic
  registration, so nobody else can mint a client.
- Redirects only to an allow-list (Claude's callback, plus any you add).
- PKCE S256 is enforced by the SDK's token handler.
- The consent page requires the owner password; failed attempts are throttled.
- Access tokens last 1 hour, refresh tokens 30 days and rotate on every use.
  Tokens are stored as SHA-256 hashes, so the file on disk can't be replayed.
"""

from __future__ import annotations

import base64
import binascii
import contextvars
import hashlib
import hmac
import html
import json
import logging
import os
import secrets
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlencode, urlparse

from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    AuthorizeError,
    RefreshToken,
    TokenError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import AnyUrl
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

log = logging.getLogger(__name__)

ACCESS_TTL = 3600
REFRESH_TTL = 30 * 24 * 3600
CODE_TTL = 300
PENDING_TTL = 600
MAX_FAILED_LOGINS = 5
LOCKOUT_S = 15 * 60

# Which client-auth method the current /token request used ("basic" or "post").
_token_auth_method: contextvars.ContextVar[str] = contextvars.ContextVar("token_auth_method", default="post")


def _h(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _basic_client_id(auth: bytes) -> str | None:
    try:
        decoded = base64.b64decode(auth[6:]).decode()
    except (binascii.Error, UnicodeDecodeError):
        return None
    return unquote(decoded.split(":", 1)[0]) if ":" in decoded else None


class TokenAuthMethodMiddleware:
    """Accept both client_secret_basic and client_secret_post at /token and /revoke.

    The SDK checks the secret only via the client's *registered* auth method and
    always reads client_id from the form body. RFC 6749 clients using HTTP Basic
    (MCP Inspector, possibly Claude) send client_id only in the header. So:
    record which method this request used (see `get_client`), and for Basic
    requests without a client_id in the body, copy it in from the header. The
    SDK still verifies the header's id and secret against the stored client."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        auth = headers.get(b"authorization", b"")
        is_basic = auth.lower().startswith(b"basic ")
        token = _token_auth_method.set("basic" if is_basic else "post")
        try:
            if is_basic and scope["method"] == "POST" and scope["path"] in ("/token", "/revoke"):
                receive, scope = await self._with_client_id(scope, receive, auth)
            await self.app(scope, receive, send)
        finally:
            _token_auth_method.reset(token)

    @staticmethod
    async def _with_client_id(scope: Scope, receive: Receive, auth: bytes) -> tuple[Receive, Scope]:
        body = b""
        while True:
            message = await receive()
            body += message.get("body", b"")
            if not message.get("more_body"):
                break
        form = parse_qs(body.decode("utf-8", "replace"))
        client_id = _basic_client_id(auth)
        if client_id and "client_id" not in form:
            body = body + (b"&" if body else b"") + urlencode({"client_id": client_id}).encode()
        scope = dict(scope)
        scope["headers"] = [(k, v) for k, v in scope["headers"] if k != b"content-length"] + [
            (b"content-length", str(len(body)).encode())
        ]
        sent = False

        async def replay() -> Message:
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        return replay, scope


@dataclass
class _Pending:
    client_id: str
    params: AuthorizationParams
    created: float


class TokenStore:
    """Hashed tokens persisted to a JSON file (one owner, a handful of tokens)."""

    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self.access: dict[str, dict[str, Any]] = {}
        self.refresh: dict[str, dict[str, Any]] = {}
        if path.is_file():
            data = json.loads(path.read_text())
            self.access = data.get("access", {})
            self.refresh = data.get("refresh", {})
        self._prune()

    def _prune(self) -> None:
        now = time.time()
        self.access = {k: v for k, v in self.access.items() if v["expires_at"] > now}
        self.refresh = {k: v for k, v in self.refresh.items() if v["expires_at"] > now}

    def save(self) -> None:
        with self._lock:
            self._prune()
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                json.dump({"access": self.access, "refresh": self.refresh}, f)
            os.replace(tmp, self.path)


class OwnerOAuthProvider:
    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        redirect_uris: list[str],
        owner_password: str,
        resource_url: str,
        issuer_url: str,
        store_path: Path,
    ):
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uris = redirect_uris
        self._owner_pw_hash = hashlib.sha256(owner_password.encode()).digest()
        self.resource_url = resource_url
        self.issuer_url = issuer_url
        self.store = TokenStore(store_path)
        self._pending: dict[str, _Pending] = {}
        self._codes: dict[str, AuthorizationCode] = {}
        self._failures: list[float] = []

    # -- client -------------------------------------------------------------

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        if not hmac.compare_digest(client_id.encode(), self._client_id.encode()):
            return None
        method = "client_secret_basic" if _token_auth_method.get() == "basic" else "client_secret_post"
        return OAuthClientInformationFull(
            client_id=self._client_id,
            client_secret=self._client_secret,
            client_name="Claude",
            redirect_uris=[AnyUrl(u) for u in self._redirect_uris],
            grant_types=["authorization_code", "refresh_token"],
            response_types=["code"],
            token_endpoint_auth_method=method,
            scope="offline_access",  # some clients ask for it to get a refresh token; we always issue one
        )

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        raise NotImplementedError("Dynamic client registration is disabled")

    # -- authorize + consent ------------------------------------------------

    def _check_resource(self, resource: str | None) -> str:
        if resource and resource.rstrip("/") != self.resource_url.rstrip("/"):
            raise AuthorizeError("invalid_target", "Unknown resource")
        return self.resource_url

    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        self._check_resource(params.resource)
        now = time.time()
        self._pending = {k: v for k, v in self._pending.items() if now - v.created < PENDING_TTL}
        txn = secrets.token_urlsafe(24)
        self._pending[txn] = _Pending(client.client_id, params, now)
        return f"{self.issuer_url}/consent?txn={txn}"

    def _locked_out(self) -> bool:
        now = time.time()
        self._failures = [t for t in self._failures if now - t < LOCKOUT_S]
        return len(self._failures) >= MAX_FAILED_LOGINS

    async def consent(self, request: Request) -> Response:
        if request.method == "GET":
            txn = request.query_params.get("txn", "")
            pending = self._pending.get(txn)
            if not pending:
                return HTMLResponse(_page("This sign-in link has expired. Start again from Claude."), 400)
            host = urlparse(str(pending.params.redirect_uri)).hostname or "?"
            return HTMLResponse(_consent_form(txn, host))

        form = await request.form()
        txn = str(form.get("txn", ""))
        pending = self._pending.get(txn)
        if not pending:
            return HTMLResponse(_page("This sign-in link has expired. Start again from Claude."), 400)
        if self._locked_out():
            log.warning("consent: locked out after repeated failures")
            return HTMLResponse(_page("Too many failed attempts. Try again in 15 minutes."), 429)

        if form.get("action") == "deny":
            self._pending.pop(txn, None)
            return RedirectResponse(
                construct_redirect_uri(
                    str(pending.params.redirect_uri), error="access_denied", state=pending.params.state
                ),
                302,
            )

        given = hashlib.sha256(str(form.get("password", "")).encode()).digest()
        if not hmac.compare_digest(given, self._owner_pw_hash):
            self._failures.append(time.time())
            log.warning("consent: wrong owner password")
            host = urlparse(str(pending.params.redirect_uri)).hostname or "?"
            return HTMLResponse(_consent_form(txn, host, error="Wrong password."), 401)

        self._pending.pop(txn, None)
        self._failures.clear()
        code = secrets.token_urlsafe(32)
        self._codes[code] = AuthorizationCode(
            code=code,
            scopes=pending.params.scopes or [],
            expires_at=time.time() + CODE_TTL,
            client_id=pending.client_id,
            code_challenge=pending.params.code_challenge,
            redirect_uri=pending.params.redirect_uri,
            redirect_uri_provided_explicitly=pending.params.redirect_uri_provided_explicitly,
            resource=self.resource_url,
            subject="owner",
        )
        log.info("consent: granted to client")
        return RedirectResponse(
            construct_redirect_uri(str(pending.params.redirect_uri), code=code, state=pending.params.state), 302
        )

    # -- codes and tokens ---------------------------------------------------

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        code = self._codes.get(authorization_code)
        if not code or code.client_id != client.client_id:
            return None
        if code.expires_at < time.time():
            self._codes.pop(authorization_code, None)
            return None
        return code

    def _issue(self, client_id: str, scopes: list[str]) -> OAuthToken:
        now = int(time.time())
        access = secrets.token_urlsafe(32)
        refresh = secrets.token_urlsafe(32)
        self.store.access[_h(access)] = {
            "client_id": client_id, "scopes": scopes, "expires_at": now + ACCESS_TTL, "refresh": _h(refresh),
        }
        self.store.refresh[_h(refresh)] = {
            "client_id": client_id, "scopes": scopes, "expires_at": now + REFRESH_TTL,
        }
        self.store.save()
        return OAuthToken(
            access_token=access,
            token_type="Bearer",
            expires_in=ACCESS_TTL,
            refresh_token=refresh,
            scope=" ".join(scopes) or None,
        )

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        if self._codes.pop(authorization_code.code, None) is None:
            raise TokenError("invalid_grant", "Authorization code already used")
        log.info("oauth: issued tokens (authorization_code)")
        return self._issue(client.client_id, authorization_code.scopes)

    async def load_refresh_token(self, client: OAuthClientInformationFull, refresh_token: str) -> RefreshToken | None:
        rec = self.store.refresh.get(_h(refresh_token))
        if not rec or rec["client_id"] != client.client_id or rec["expires_at"] < time.time():
            return None
        return RefreshToken(
            token=refresh_token, client_id=rec["client_id"], scopes=rec["scopes"],
            expires_at=rec["expires_at"], resource=self.resource_url, subject="owner",
        )

    async def exchange_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: RefreshToken, scopes: list[str]
    ) -> OAuthToken:
        old = _h(refresh_token.token)
        if self.store.refresh.pop(old, None) is None:
            raise TokenError("invalid_grant", "Refresh token already used")
        # Rotation: the old refresh token and the access tokens it minted die now.
        self.store.access = {k: v for k, v in self.store.access.items() if v.get("refresh") != old}
        log.info("oauth: issued tokens (refresh_token)")
        return self._issue(client.client_id, scopes or refresh_token.scopes)

    async def load_access_token(self, token: str) -> AccessToken | None:
        rec = self.store.access.get(_h(token))
        if not rec or rec["expires_at"] < time.time():
            return None
        return AccessToken(
            token=token, client_id=rec["client_id"], scopes=rec["scopes"],
            expires_at=rec["expires_at"], resource=self.resource_url, subject="owner",
        )

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        h = _h(token.token)
        if isinstance(token, RefreshToken):
            self.store.refresh.pop(h, None)
            self.store.access = {k: v for k, v in self.store.access.items() if v.get("refresh") != h}
        else:
            rec = self.store.access.pop(h, None)
            if rec:
                self.store.refresh.pop(rec.get("refresh", ""), None)
        self.store.save()


# -- pages --------------------------------------------------------------------

_STYLE = """
:root{--bg:#f6f1e7;--fg:#1c1a17;--muted:#6b645a;--accent:#c8402f;--card:#fffdf8;--line:#1c1a17}
@media (prefers-color-scheme: dark){:root{--bg:#171512;--fg:#f1ebe0;--muted:#a59d90;--accent:#e46a57;--card:#221f1b;--line:#f1ebe0}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);
font:16px/1.5 system-ui,-apple-system,sans-serif;padding:16px}
main{width:100%;max-width:380px;background:var(--card);border:2px solid var(--line);box-shadow:4px 4px 0 var(--line);padding:24px}
h1{font-size:20px;margin:0 0 8px}p{margin:0 0 16px;color:var(--muted)}b{color:var(--fg)}
input{width:100%;font:inherit;padding:10px;border:2px solid var(--line);background:var(--bg);color:var(--fg);margin-bottom:12px}
.row{display:flex;gap:8px}button{flex:1;font:inherit;font-weight:600;padding:10px;border:2px solid var(--line);cursor:pointer;
background:var(--bg);color:var(--fg)}button.go{background:var(--accent);color:#fff}.err{color:var(--accent);font-weight:600}
"""


def _page(body: str) -> str:
    return (
        "<!doctype html><html lang=en><head><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>Nostalge connector</title><style>{_STYLE}</style></head><body><main>{body}</main></body></html>"
    )


def _consent_form(txn: str, redirect_host: str, error: str = "") -> str:
    err = f"<p class=err>{html.escape(error)}</p>" if error else ""
    return _page(
        "<h1>Connect your music library?</h1>"
        f"<p><b>{html.escape(redirect_host)}</b> is asking to read your library and create or edit "
        "playlists in your TIDAL account.</p>"
        f"{err}<form method=post action=consent>"
        f"<input type=hidden name=txn value='{html.escape(txn, quote=True)}'>"
        "<input type=password name=password placeholder='Owner password' autocomplete=current-password autofocus>"
        "<div class=row><button class=go name=action value=allow>Allow</button>"
        "<button name=action value=deny>Deny</button></div></form>"
    )
