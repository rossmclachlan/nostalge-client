# nostalge MCP server

Lets Claude (claude.ai on the web, desktop and mobile) read your music library and build TIDAL
playlists from it. Runs on the NAS next to PocketBase, reached through Tailscale Funnel, protected by
OAuth.

```
Claude ──HTTPS──▶ Tailscale Funnel ──▶ nostalge-mcp (:8000) ──▶ PocketBase (music-cms-mvp)
                                             └──────────────▶ TIDAL (tidalapi) · MusicBrainz
```

## Tools

| Tool | What it does |
|---|---|
| `list_crates(query?, sort?, limit?, offset?)` | Albums ("crates") with artist, year and play count |
| `get_crate_tracks(crate_id)` | One album's tracklist (track ids for the playlist tools) |
| `list_tags(limit?)` | Genre/mood/era tags, most used first |
| `get_tagged_tracks(tags[], match_all?, limit?)` | Tracks whose album or artist carries the tags |
| `search_library(query, limit?)` | Tracks by title, artist or album name |
| `get_recent_discoveries(limit?, days?)` | Tracks first ever played in the last N days |
| `match_tracks(track_ids[])` | Find tracks on TIDAL: tidal_id, confidence, matched title/artist/album, or why it missed |
| `create_playlist(name, track_ids[], description?, dry_run=true)` | Preview, then create a TIDAL playlist in the given order |
| `add_to_playlist(playlist_id, track_ids[], dry_run=true)` | Preview, then append to one of *your* playlists (duplicates skipped) |
| `list_my_playlists()` | Your TIDAL playlists |

The library tools are read-only. The playlist tools default to `dry_run=true`, and the server tells
Claude to show you the preview before writing anything.

## How matching works

For each library track:

1. **Cache.** If the track is already in the `tidal_matches` collection with enough confidence, that
   match is used and TIDAL isn't called.
2. **ISRC.** If the track has a MusicBrainz recording ID (`tracks.mbid`), its ISRCs are fetched from
   MusicBrainz and looked up on TIDAL. A hit counts only if the title and artist also agree, because some
   MBIDs come from fuzzy matching.
3. **Search.** TIDAL is searched with `artist + title`, then `title + album`, then `title`, stopping
   at the first confident result.

Each candidate gets a confidence score built from:

- normalised title (45%) and artist (35%) similarity, which ignores accents, `&`/"and", "The",
  `(feat. …)` and `- 2011 Remaster` suffixes
- album similarity (10%)
- duration (10%): full credit within **±5 s**, and an extra penalty that grows past that, because a
  track 40 s longer is usually a different edit

**Version penalties.** These apply when the TIDAL track is a version your library track isn't:

| Version | Penalty |
|---|---|
| karaoke, sped up / slowed / nightcore | 0.60 |
| cover / tribute | 0.50 |
| live | 0.30 |
| instrumental | 0.30 |
| remix | 0.25 |
| acoustic / demo | 0.20 |
| remaster | 0.05 (same recording, so it barely matters) |

Versions are detected only from the bracketed or dash-suffix parts of a title, TIDAL's version field,
and (for live) the album title. A song *called* "Live Forever" therefore isn't treated as live. If your
library track is "(Live)" or "(Sped Up)", the matching version is preferred instead.

Matches scoring at or above `MATCH_MIN_CONFIDENCE` (default 0.80) are used and cached. Anything lower is
reported as a miss, along with the best candidate and the reason (for example "duration differs by 44s;
live version").

Tracks are added in batches of 50. TIDAL rate limits (429) and 5xx responses are retried up to 5 times
with backoff, honouring `Retry-After`.

## Setup on the NAS

### 1. Apply the PocketBase migration (the only PocketBase change)

The migration lives in the backend repo at `music-cms-mvp/pocketbase/pb_migrations/010_tidal_matches.js`
(on branch `ccr-9db28f2d-v8cjf2`). It does two things:

- **Creates the `tidal_matches` collection:** `library_track` (relation → tracks, unique), `tidal_id`,
  `confidence`, `method`, `matched_title`, `matched_artist`, `matched_album` and `matched_at`. Only
  logged-in users can read it or write to it, and nobody can delete through the API.
- **Turns off public sign-up on the built-in `users` collection.** PocketBase allows anyone to sign up
  by default, which would let anyone on your network write to the cache.

```bash
cd /volume1/docker/music-cms          # your music-cms-mvp checkout
git fetch && git checkout ccr-9db28f2d-v8cjf2   # or merge it into main
docker compose restart pocketbase     # migrations run on start (pb_migrations is mounted)
```

### 2. Create the service user

In the PocketBase admin UI (`http://<nas>:8095/_/`), go to **Collections → users → New record**. Set an
email (e.g. `mcp@nostalge.local`), a long random password, and **Verified** = on. This is the only
account the MCP server uses.

### 3. Configure

```bash
cd /volume1/docker/nostalge-client/mcp-server
cp .env.example .env
openssl rand -hex 32      # -> OAUTH_CLIENT_SECRET
```

Fill in `.env`:

- `PB_EMAIL` / `PB_PASSWORD`: the service user from step 2
- `PUBLIC_BASE_URL`: your tunnel hostname (step 6), e.g. `https://mcp.example.com`
- `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET`: you'll paste these into Claude
- `OWNER_PASSWORD`: what you type on the consent page when connecting
- `PB_DOCKER_NETWORK`: the music-cms stack's network (`docker network ls`, usually `music-cms_default`)

`.env` and `data/` are gitignored. Keep them private: `data/` holds your TIDAL session and the OAuth
tokens (stored hashed).

### 4. Build and start

```bash
docker compose up -d --build
docker compose logs -f nostalge-mcp
curl http://localhost:8765/healthz    # {"status":"ok"}
```

### 5. Log in to TIDAL (once)

```bash
docker compose run --rm nostalge-mcp python -m server login
```

Open the printed `link.tidal.com/...` URL, approve the device, and the session is saved to
`data/tidal-session.json`. Access tokens refresh automatically. If TIDAL ever revokes the session, tools
return "TIDAL session is not valid … re-run the one-time login", and you run the same command again.

### 6. Expose it publicly: Tailscale Funnel

Claude connects from Anthropic's servers, so the server needs a public HTTPS URL. If the NAS is already
on your tailnet, **Tailscale Funnel** gives you one without opening any ports on your router and without
another container — it runs as a feature of the Tailscale client already installed on the NAS.

**PocketBase must stay tailnet-only.** Only `nostalge-mcp` goes public; don't Funnel port 8095.

1. In DSM, confirm the Tailscale package is up to date and that **MagicDNS**, **HTTPS Certificates**, and
   the **Funnel** node attribute are enabled for this machine in the
   [Tailscale admin console](https://login.tailscale.com/admin/machines) (Funnel is gated per-tailnet
   under **Settings → Funnel** and may need enabling for the first time).
2. On the NAS, start the funnel against the port already published in `docker-compose.yml`:
   ```bash
   tailscale funnel --bg 8765
   ```
   This serves `https://<nas-machine-name>.<tailnet-name>.ts.net` → `localhost:8765` →
   `nostalge-mcp:8000`. Check status any time with `tailscale funnel status`.
3. Set `PUBLIC_BASE_URL` in `.env` to that `https://...ts.net` hostname (no trailing slash, no path).
4. Check it from outside your tailnet (e.g. your phone on cellular data):
   - `curl https://<nas-machine-name>.<tailnet-name>.ts.net/healthz` should return ok.
   - `curl -i -X POST https://<nas-machine-name>.<tailnet-name>.ts.net/mcp` should return **401** with a
     `WWW-Authenticate` header.

To stop exposing it: `tailscale funnel --https=443 off` (or the exact invocation `tailscale funnel
status` shows).

#### Alternative: Cloudflare Tunnel

If you'd rather not rely on Tailscale Funnel (e.g. you want a custom domain, or the NAS isn't on your
tailnet), the `cloudflared` service in `docker-compose.yml` sets up a Cloudflare Tunnel instead:

1. In the Cloudflare dashboard, go to **Zero Trust → Networks → Tunnels → Create a tunnel →
   Cloudflared**, name it (e.g. `nas-mcp`), and copy the **tunnel token**.
2. Add a **Public hostname**: `mcp.<your-domain>` → service `HTTP` → `nostalge-mcp:8000`. The tunnel
   container shares the Docker network, so that name resolves.
3. Put the token in `.env` as `CLOUDFLARE_TUNNEL_TOKEN`, make `PUBLIC_BASE_URL` match the hostname,
   then run:
   ```bash
   docker compose --profile tunnel up -d
   ```
4. Check it the same way as step 4 above, against `https://mcp.<your-domain>` instead.

Notes:
- **Don't put Cloudflare Access (Zero Trust login) in front of this hostname.** Claude's servers can't
  get past it, and OAuth already protects the endpoint.
- **Optional hardening:** add a WAF custom rule for this hostname that blocks requests whose IP is not
  in Anthropic's egress range `160.79.104.0/21`, except for `/consent` (your browser opens that page).
  This also blocks Claude Code and MCP Inspector from outside, so test first.
- If you already run nginx for the PWA, you can point the tunnel at nginx instead. Nothing else in the
  setup changes.

### 7. Add the connector in Claude

1. On claude.ai (web), go to **Settings → Connectors → Add custom connector**.
2. Name: `Nostalge`. URL: `https://mcp.<your-domain>/mcp` (including `/mcp`).
3. Open **Advanced settings** and paste `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET`.
4. Click **Add**, then **Connect**. A Nostalge consent page opens. Enter `OWNER_PASSWORD`, then click
   **Allow**.

Once added on the web, the connector also appears in the Claude desktop and mobile apps. Turn it on in a
chat from the tools menu.

**Why OAuth:** claude.ai custom connectors for individual accounts support only OAuth or no auth (static
API-key headers are an organization-only beta), and an unauthenticated endpoint that can edit your TIDAL
account is not acceptable. The server is a minimal OAuth 2.1 authorization server:

- One pre-registered client and no dynamic registration, so nobody else can register a client.
- Redirects go only to `https://claude.ai/api/mcp/auth_callback` (plus any you add for testing).
- PKCE S256 is required.
- The consent page requires your password and locks for 15 minutes after 5 wrong attempts.
- Access tokens last 1 hour. Refresh tokens last 30 days and rotate on every use.
- Tokens are stored as SHA-256 hashes.
- Host/Origin headers are checked (DNS-rebinding protection).

**To revoke access:** remove the connector in Claude, or delete `data/oauth-tokens.json` and restart.
Changing `OAUTH_CLIENT_SECRET` also cuts off the existing client.

## Example prompts

- "What's in my shoegaze crate? Build me a TIDAL playlist from the best of it, dry run first."
- "Find the tracks I discovered in the last two months and turn them into a playlist called
  *September finds*."
- "Make a 90s britpop playlist, but only deep cuts I've played fewer than 10 times."
- "Match the Definitely Maybe tracklist on TIDAL and tell me which ones it couldn't find."
- "Add everything from Souvlaki to my *Late night* TIDAL playlist."
- "Which of my TIDAL playlists did I make most recently?"

## Logs

Every tool call is logged with its name, arguments (long id lists are summarised), outcome and duration:

```
INFO nostalge_mcp: tool create_playlist {'name': 'Test set', 'track_ids': '<12 ids>', 'description': '', 'dry_run': True} -> ok in 4.2s
```

Tokens, passwords, the TIDAL session and request headers are never logged. Uvicorn's access log is off
because OAuth query strings would otherwise appear in it, and the `tidalapi`/`httpx`/`requests` loggers
are capped at WARNING.

## Local development and testing

```bash
cd mcp-server
python -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/pytest                                  # matching, matcher, TIDAL adapter, OAuth: no network
```

**Against a real PocketBase.** Use a throwaway one with the music-cms-mvp migrations applied:

```bash
python tests/dev/seed_pocketbase.py http://127.0.0.1:8090 <admin-email> <admin-password>
NOSTALGE_TEST_PB_URL=http://127.0.0.1:8090 .venv/bin/pytest tests/test_live_pocketbase.py
```

**With MCP Inspector.** Set `PUBLIC_BASE_URL=http://localhost:8000` and
`OAUTH_EXTRA_REDIRECT_URIS=http://localhost:6274/oauth/callback` in `.env`, then start the server:

```bash
.venv/bin/python -m server serve
```

- **UI** (tested with Inspector 2.9):
  1. Run `npx @modelcontextprotocol/inspector` and open the printed `http://127.0.0.1:6274?...` link,
     changing the host to `localhost` so the OAuth callback matches `OAUTH_EXTRA_REDIRECT_URIS`.
  2. On the HTTP server card, use **Edit** to set the URL to `http://localhost:8000/mcp`.
  3. Under **Settings → OAuth Settings**, enter the Client ID and Client Secret.
  4. Flip the card's connect toggle. Your consent page opens; enter `OWNER_PASSWORD` and click
     **Allow**. Inspector connects and lists the tools.
- **CLI:**
  ```bash
  TOKEN=$(.venv/bin/python tests/dev/get_token.py http://localhost:8000 <client_id> <secret> <owner_password>)
  npx @modelcontextprotocol/inspector --cli http://localhost:8000/mcp --transport http \
    --header "Authorization: Bearer $TOKEN" --method tools/call --tool-name search_library --tool-arg query=oasis
  ```

`python -m tests.dev.run_fake_tidal` serves the same app with an in-memory fake TIDAL, so you can try the
playlist tools without touching your account.

## Swapping to the official TIDAL API later

Everything TIDAL-specific lives in `server/tidal.py` behind the `TidalBackend` protocol (search, ISRC
lookup, create, add, list, get own playlist). To switch, write a second implementation and change one
line in `create_app`.

## Known limits

- **Track order within a crate** follows import order. The backend stores no track numbers.
- **Tags** come from album and artist tags. Tracks have no tags of their own.
- **MusicBrainz lookups** are limited to 1 per second. A first big playlist of tracks that have MBIDs is
  slower; repeat runs are served from the cache. Set `MUSICBRAINZ_LOOKUP=false` to search only.
- **`tidalapi` is unofficial.** It can break if TIDAL changes its private API; upgrade it, or swap the
  backend as described above.
