# nostalge MCP Worker

A remote MCP server on Cloudflare Workers that lets Claude browse the nostalge music library.
Built from Cloudflare's [`remote-mcp-github-oauth`](https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-github-oauth)
template.

```
Claude ──▶ Worker (/mcp)  ──HTTPS──▶  Tailscale Funnel ──▶ PocketBase on the NAS
            │
            └─ OAuth: sign in with GitHub; only ALLOWED_USERNAMES get tools
```

## Tools

| Tool | What it does |
|---|---|
| `search_library(query, limit?)` | Artists, releases (albums) and tracks whose names match |
| `list_crates(limit?, page?)` | Crates, most played first, with artist, year and tags |
| `get_crate(crateId)` | One crate with artist, tags, notes and its tracklist |
| `releases_by_tag(tag, limit?)` | Releases carrying a tag such as `shoegaze` or `90s` |
| `create_tidal_playlist(name, description?, tracks[])` | **Stub.** Returns `not_implemented` (see the TODO in `src/index.ts`) |

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
```

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

## The TIDAL stub

`create_tidal_playlist` validates its input and returns `{"status": "not_implemented"}` without
contacting TIDAL. The TODO in `src/index.ts` lists what's needed:

- TIDAL OAuth (authorization code + PKCE) with a stored refresh token
- catalogue search and match scoring
- the playlist create/add-items calls, with batching and 429 backoff
- a `dry_run` flag

The Python server in `../mcp-server` has tested matching logic that can be ported.
