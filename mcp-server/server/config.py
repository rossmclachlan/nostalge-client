"""Settings, read once from the environment (and a .env file when present)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader: KEY=VALUE lines, no interpolation. Real env wins."""
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


class ConfigError(RuntimeError):
    pass


def _req(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigError(f"Missing required environment variable {name} (see .env.example)")
    return value


def _float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    return float(raw) if raw else default


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    # PocketBase
    pb_url: str
    pb_email: str
    pb_password: str

    # Public URL Claude reaches us at, e.g. https://mcp.example.com (no trailing slash)
    public_base_url: str

    # OAuth: the single pre-registered client, and the owner password for the consent page
    oauth_client_id: str
    oauth_client_secret: str
    owner_password: str
    oauth_redirect_uris: list[str] = field(default_factory=list)

    data_dir: Path = Path("/data")
    host: str = "0.0.0.0"
    port: int = 8000

    match_min_confidence: float = 0.80
    musicbrainz_lookup: bool = True
    musicbrainz_contact: str = "https://github.com/rossmclachlan/nostalge-client"

    @property
    def mcp_url(self) -> str:
        return f"{self.public_base_url}/mcp"

    @property
    def tidal_session_file(self) -> Path:
        return self.data_dir / "tidal-session.json"

    @property
    def oauth_store_file(self) -> Path:
        return self.data_dir / "oauth-tokens.json"


CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback"


def load_settings(*, require_oauth: bool = True) -> Settings:
    """`require_oauth=False` is for `login`, which needs only DATA_DIR."""
    _load_dotenv(Path(os.environ.get("ENV_FILE", ".env")))

    extra = [u.strip() for u in os.environ.get("OAUTH_EXTRA_REDIRECT_URIS", "").split(",") if u.strip()]

    def oauth(name: str) -> str:  # required when serving
        return _req(name) if require_oauth else os.environ.get(name, "")

    owner_password = oauth("OWNER_PASSWORD")
    if require_oauth and len(owner_password) < 12:
        raise ConfigError("OWNER_PASSWORD must be at least 12 characters")
    client_secret = oauth("OAUTH_CLIENT_SECRET")
    if require_oauth and len(client_secret) < 32:
        raise ConfigError("OAUTH_CLIENT_SECRET must be at least 32 characters (use `openssl rand -hex 32`)")

    return Settings(
        pb_url=oauth("PB_URL").rstrip("/"),
        pb_email=oauth("PB_EMAIL"),
        pb_password=oauth("PB_PASSWORD"),
        public_base_url=(oauth("PUBLIC_BASE_URL") or "http://localhost:8000").rstrip("/"),
        oauth_client_id=oauth("OAUTH_CLIENT_ID"),
        oauth_client_secret=client_secret,
        owner_password=owner_password,
        oauth_redirect_uris=[CLAUDE_CALLBACK, *extra],
        data_dir=Path(os.environ.get("DATA_DIR", "/data")),
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8000")),
        match_min_confidence=_float("MATCH_MIN_CONFIDENCE", 0.80),
        musicbrainz_lookup=_bool("MUSICBRAINZ_LOOKUP", True),
        musicbrainz_contact=os.environ.get(
            "MUSICBRAINZ_CONTACT", "https://github.com/rossmclachlan/nostalge-client"
        ),
    )
