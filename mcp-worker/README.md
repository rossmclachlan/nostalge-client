# nostalge MCP Worker

A remote MCP server on Cloudflare Workers that lets Claude browse the nostalge music library.
Built from Cloudflare's [`remote-mcp-github-oauth`](https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-github-oauth)
template.

```
Claude ──▶ Worker (/mcp)  ──HTTPS──▶  Tailscale Funnel ──▶ PocketBase on the NAS
            │
            ├─ OAuth: sign in with GitHub; only ALLOWED_USERNAMES get tools
            └─ TIDAL API (openapi.tidal.com), signed in once via /tidal/callback
```

## Tools

| Tool | What it does |
|---|---|
| `search_library(query, limit?)` | Artists, releases (albums) and tracks whose names match |
| `list_crates(limit?, page?)` | Crates, most played first, with artist, year and tags |
| `get_crate(crateId)` | One crate with artist, tags, notes and its tracklist |
| `releases_by_tag(tag, limit?)` | Releases carrying a tag such as `shoegaze` or `90s` |
| `connect_tidal()` | Whether TIDAL is connected, plus a one-time sign-in link (valid 10 minutes) |
| `create_tidal_playlist(name, description?, track_ids[], dry_run?)` | Matches library tracks on TIDAL and creates an unlisted playlist in that order. `dry_run` (default `true`) only previews the matches and misses |

**How the PocketBase schema maps to these tools.** The schema comes from the `music-cms-mvp`
migrations. It has no `crates` or `releases` collections, so:

- A **crate** is an album, matching the app's Crates tab.
- A **release** is that same album.
- Tags come from the albums' `tag_relations`.

Tools are registered only when the signed-in GitHub login is in `ALLOWED_USERNAMES`
(`src/index.ts`). Anyone else can finish the GitHub sign-in but sees no tools.

## Manual setup

You need a Cloudflare account, the GitHub repo secrets below, and shell access to the NAS.

### 1. Allow your GitHub user

Edit `src/index.ts` and add your GitHub username to `ALLOWED_USERNAMES`:

```ts
const ALLOWED_USERNAMES = new Set<string>(["rossmclachlan"].map(...));
```

### 2. Create the OAuth KV namespace

```bash
cd mcp-worker && npm ci
npx wrangler login
npx wrangler kv namespace create OAUTH_KV
```

Put the printed `id` into `wrangler.jsonc` in place of `<Add-KV-ID>` and commit it. KV ids are not
secret.

### 3. First deploy (to get the Worker URL)

Push to `main` (the GitHub Action deploys, see step 9), or run `npx wrangler deploy` once. The URL is
`https://nostalge-mcp.<your-subdomain>.workers.dev`, called `<worker>` below.

### 4. Create the GitHub OAuth app

On GitHub, go to **Settings → Developer settings → OAuth Apps → New OAuth App**:

- **Application name:** `nostalge MCP`
- **Homepage URL:** `https://<worker>.workers.dev`
- **Authorization callback URL:** `https://<worker>.workers.dev/callback`

Copy the **Client ID**, then **Generate a new client secret** and copy that too.

### 5. Create a dedicated PocketBase superuser

Use a new account just for the Worker, not your personal admin account, so you can revoke it on its
own.

- **PocketBase 0.22** (what `music-cms-mvp` currently runs): admin UI → **Settings → Admins → New
  admin**.
- **PocketBase 0.23 or later:** admin UI → **System → _superusers → New record**.

The Worker supports both: it tries `/api/collections/_superusers/auth-with-password` first and falls
back to `/api/admins/auth-with-password`. Use a long random password.

> ⚠️ PocketBase superusers can't be scoped: this account can read, change and delete everything,
> including the settings. Read **Security** below before going further.

### 6. Expose PocketBase with Tailscale Funnel

On the NAS (PocketBase is published on host port **8095** in `music-cms-mvp/docker-compose.yml`):

```bash
sudo tailscale funnel --bg 8095
tailscale funnel status          # shows https://<nas>.<tailnet>.ts.net
```

Funnel needs MagicDNS and HTTPS certificates turned on for the tailnet, and the `funnel` attribute
in your tailnet policy (the admin console offers to add it the first time). On Synology the CLI may
live at `/var/packages/Tailscale/target/bin/tailscale`.

Check it from outside your network: `curl https://<nas>.<tailnet>.ts.net/api/health` should answer.

### 7. Set the Worker secrets

```bash
npx wrangler secret put GITHUB_CLIENT_ID        # from step 4
npx wrangler secret put GITHUB_CLIENT_SECRET    # from step 4
npx wrangler secret put COOKIE_ENCRYPTION_KEY   # paste the output of: openssl rand -hex 32
npx wrangler secret put PB_URL                  # https://<nas>.<tailnet>.ts.net  (no trailing slash needed)
npx wrangler secret put PB_EMAIL                # the superuser from step 5
npx wrangler secret put PB_PASSWORD
npx wrangler secret put TIDAL_CLIENT_ID         # from step 10 (add it once you have it)
```

You can also add them in the Cloudflare dashboard: **Workers & Pages → nostalge-mcp → Settings →
Variables and Secrets**, type **Secret**.

### 8. Add the connector in Claude

On claude.ai, go to **Settings → Connectors → Add custom connector**:

1. Name it `Nostalge`.
2. Set the URL to `https://<worker>.workers.dev/mcp`.
3. Leave Advanced settings empty. The Worker supports dynamic client registration, so Claude
   registers itself.
4. Click **Connect**, approve the consent screen, and sign in with GitHub.

The connector then works in Claude on the web, desktop and mobile.

### 9. GitHub Actions deploys

`.github/workflows/deploy-mcp-worker.yml` typechecks and runs `wrangler deploy` on every push to
`main` that changes `mcp-worker/`. You can also run it by hand from the Actions tab.

Add two repository secrets (**Settings → Secrets and variables → Actions**):

- **`CLOUDFLARE_API_TOKEN`:** create it in Cloudflare under **My Profile → API Tokens** from the
  **Edit Cloudflare Workers** template.
- **`CLOUDFLARE_ACCOUNT_ID`:** shown in the Workers & Pages overview sidebar.

Worker secrets (step 7) are not touched by deploys.

### 10. Connect TIDAL

1. At [developer.tidal.com](https://developer.tidal.com), create an app:
   - Scopes: `playlists.read`, `playlists.write`, `search.read` and `user.read`.
   - Redirect URI: `https://<worker>.workers.dev/tidal/callback`. It must match `PUBLIC_URL` in
     `wrangler.jsonc` plus `/tidal/callback`.
2. Add its **Client ID** as the Worker secret `TIDAL_CLIENT_ID`. The client secret isn't needed,
   because the login uses PKCE.
3. In Claude, ask it to connect TIDAL. The `connect_tidal` tool returns a link. Open it, sign in
   to TIDAL and approve. The page should say "TIDAL connected".

The session is stored in `OAUTH_KV`, encrypted with a key derived from `COOKIE_ENCRYPTION_KEY`.
Changing that key disconnects TIDAL; run step 3 again.

## Security

**Funnel makes all of PocketBase public, not just what the Worker uses.** That includes:

- **Your data:** the `artists`, `albums`, `tracks`, `scrobbles` and `tags` collections allow
  anonymous reads (migration `008_public_read_access.js`), so anyone who learns the `ts.net` URL can
  read your whole library and listening history without logging in.
- **The admin UI** (`/_/`) and the superuser login endpoint, which can be targeted by password
  guessing.

Ways to reduce that exposure, roughly from least to most effort:

1. **Use a long random password** for every PocketBase admin/superuser, and keep the `ts.net`
   hostname to yourself.
2. **Remove anonymous read access.** Set the five collections' list/view rules back to admin-only;
   the Worker authenticates, so it keeps working. The nostalge PWA reads anonymously over the LAN
   or tailnet, so it would need an auth token first. That's a trade-off to decide.
3. **Put a small reverse proxy in front of PocketBase** and Funnel that instead. It would allow only
   `/api/collections/{artists,albums,tracks,tags}/records` and the auth endpoint, and require a
   shared header from the Worker.

## Local development

```bash
cp .dev.vars.example .dev.vars    # fill in; use a second GitHub OAuth app whose callback is http://localhost:8788/callback
npm run dev                       # http://localhost:8788/mcp
npx @modelcontextprotocol/inspector   # Streamable HTTP, URL http://localhost:8788/mcp
npm run type-check
npm run cf-typegen                # after changing bindings in wrangler.jsonc
```

Secrets are declared for TypeScript in `src/env.d.ts`, because `wrangler types` only sees bindings.

## How TIDAL playlists are built

`create_tidal_playlist` takes library track ids from `get_crate` or `search_library`.

**Matching.** Each track is searched on TIDAL, trying up to three queries from most to least
specific. Candidates are scored by `src/matching.ts`, a port of `../mcp-server/server/matching.py`:
- similarity of title, artist and album, plus duration within ±5 s
- penalties for live, karaoke, cover, sped-up and similar versions the library track isn't

A track matches at a confidence of 0.80 or more. Anything lower is reported as a miss with the
reason and the best candidate, never guessed. The Python server also looks up ISRCs through
MusicBrainz; the Worker doesn't, to save requests.

**Shared cache.** Matches are written to PocketBase's `tidal_matches`, which the Python server
reads and writes too, so each server reuses the other's matches.

**Workers Free and its request limit.** On the free plan, one tool call can make only 50
outbound requests. Each track costs:
- 2 requests per search query, and up to 3 queries
- 1 request to write the match to the cache

So the tool works as a resumable job:
- Each call matches as many tracks as fit, saves progress in the Durable Object's storage, and
  returns `status: "in_progress"`.
- Calling again with the same arguments continues.
- A 60-track playlist takes about four calls to preview and one more to create.

`SUBREQUEST_LIMIT` in `wrangler.jsonc` sets the per-call budget. Raise it on a paid plan, which
allows 10,000, and most playlists then finish in one call.

**Writes.**
- The playlist is created unlisted.
- Tracks are added in batches of 50, skipping any already in the playlist.
- Both writes send an `Idempotency-Key`, and progress is saved after each batch, so retries
  never duplicate the playlist or its tracks.
- Calling again with `dry_run=false` and the same name returns the existing playlist.

**Checking the matching port.** `node scripts/check-matching-parity.mjs` scores a fixed set of
tracks with both the Python and TypeScript matchers and fails on any difference. It needs
`python3`.
