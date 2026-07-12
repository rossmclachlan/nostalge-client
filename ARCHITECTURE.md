# Nostalge — Architecture Overview

Nostalge is a **mobile-first, offline-graceful PWA** for rediscovering a personal music library. It reads a Last.fm-derived collection from a self-hosted **PocketBase** backend that lives on a home LAN (only intermittently reachable), and presents it as a DIY-zine "record crate." It is a **fully static site** (Astro `output: 'static'`) hosted on **GitHub Pages**, with a single React island doing all the interactivity.

Live: `https://rossmclachlan.github.io/nostalge-client/`

## Stack
- **Astro 5** (`output: 'static'`, `base: '/nostalge-client'`) — build + HTML shell only.
- **React 18** — one `client:only` island (`src/components/App.tsx`) that IS the whole app.
- **TypeScript** (strict), path alias `@/* → src/*`.
- **Tailwind CSS v4** via `@tailwindcss/vite` (no `tailwind.config.js`; design tokens live in CSS `@theme`).
- **PocketBase JS SDK** `0.21.5` (pinned).
- **@vite-pwa/astro** (Workbox) for the installable PWA + offline app shell.
- No test suite, no linter config, no `tailwind.config.js`, no `CLAUDE.md`.

## Mental model (read this first)
- **One page, one island.** `src/pages/index.astro` renders `<App client:only="react">`. There is no SSR and no client routing library — "tabs" and "detail pages" are React state inside `App.tsx`.
- **Cache-first, manual sync.** The app always renders instantly from `localStorage`. It does **not** hit the network on load. Syncing only happens when the user taps **Refresh** (deliberate, because the LAN backend is usually unreachable when away from home).
- **Never an error state.** Every network read is wrapped in try/catch and fails silently, falling back to cache; worst case is an empty/welcome screen.
- **Everything is derived from cached data.** Tabs compute their views from the cached `MusicData` with pure functions — no per-view fetching (except an album's tracklist, fetched on demand).

## Directory map
```
src/
  pages/index.astro          Sole route; mounts <App client:only="react"> + hydration fallback
  layouts/Layout.astro       <head>, Google Fonts, pre-paint theme script, PWA manifest link + SW registration
  styles/global.css          Tailwind v4 import; @theme tokens; .dark overrides; zine component/utility classes

  lib/
    types.ts                 PocketBase collection shapes + local cache shapes + ConnectionState
    pb.ts                    PocketBase client + all network reads (healthCheck, paged fetchers, tracks, recent plays)
    cache.ts                 localStorage read/write for MusicData (key `nostalge:data:v1`)
    useLibrary.ts            Main data hook: cache-first, MANUAL sync via refresh()
    useRecentPlays.ts        Recent-tab data hook: own cache (`nostalge:recent:v1`), manual refresh
    derive.ts                Pure derivations (tags, crates, stats, last-played maps)
    format.ts                Presentation helpers (formatPlays, initials, swatchFor, relativeAge, clockTime, dayHeading, plainText)
    cn.ts                    clsx + tailwind-merge className helper
    discovery/
      engine.ts              Card model, EngineCtx builder, seeded weighted selection, shown-tracking
      cards.ts               32 card generators (22 active, 10 dormant); GENERATORS array

  components/
    App.tsx                  Root island: tab state, detail navigation stack, discoverySeed, Masthead
    BottomNav.tsx            Fixed 5-tab bottom nav (Tab type + ITEMS)
    Cover.tsx                Album/artist artwork with generated initials fallback + aged overlay
    ThemeToggle.tsx          Light/dark flip (writes `nostalge:theme`, updates theme-color meta)
    InstallButton.tsx        PWA install button gated on `beforeinstallprompt`
    CopyButton.tsx           Copy-to-clipboard (async API + execCommand fallback)
    DetailHeader.tsx         Sticky back-bar for detail views
    ui.tsx                   Shared primitives: SectionHeader, Chip, PlayBadge, EmptyState
    icons.tsx                Inline SVG icon set
    crates/  CratesTab.tsx (album grid + search), AlbumDetail.tsx, ArtistDetail.tsx
    discovery/ DiscoveryTab.tsx (runs engine, renders cards, shuffle), DiscoveryCard.tsx
    tags/    TagsTab.tsx (divider-card index), TagDetail.tsx (albums shuffleable + artists)
    stats/   StatsTab.tsx (headline figures + top lists)
    recent/  RecentTab.tsx (sync-status panel + scrobbles grouped by day)
```

## Data layer

### Backend shapes (`src/lib/types.ts`)
PocketBase collections (all `extends RecordModel` → also carry `id`, `created`, `updated`):
- **Artist**: `name, mbid, lastfm_url, image_url, bio, tags[], tag_relations[], similar_artists[], play_count, listener_count`
- **Album**: `title, artist (artist id), mbid, lastfm_url, image_url, tags[], tag_relations[], wiki_summary, play_count, track_count`
- **Track**: `title, artist, album, mbid, lastfm_url, duration, play_count`
- **Scrobble**: `track, scrobbled_at`
- **Tag**: `name, usage_count`

Local cache shapes:
- **PlayEvent** (slimmed scrobble): `{ ar: artistId, al: albumId, at: ISO }`
- **RecentPlay**: `{ id, track, artist, album, at }`
- **MusicData**: `{ artists[], albums[], tags[], plays: PlayEvent[], fetchedAt }`
- **ConnectionState**: `'live' | 'cached' | 'empty'`

### Network reads (`src/lib/pb.ts`)
- `POCKETBASE_URL` = `import.meta.env.PUBLIC_POCKETBASE_URL` (baked at build; fallback `http://127.0.0.1:8090`). `pb.autoCancellation(false)`.
- Conventions on **every** read: pass `{ requestKey: null }`, use paginated `getList()` (never `getFullList()`), wrap in try/catch, return partial/empty on failure.
- `healthCheck(2500ms)` — `fetch(${URL}/api/health)` with an `AbortController` timeout; returns `res.ok`, never throws.
- `fetchPaged` — loops `getList(page, 200)` up to per-collection caps: **artists 1000, albums 2000, tags 300, plays 4000**.
- `fetchArtists` / `fetchAlbums` / `fetchTags` / `fetchPlays` (scrobbles → slim `PlayEvent[]`).
- `fetchRecentPlays(100)` — newest scrobbles expanded to display fields (Recent tab).
- `fetchTracksForAlbum(id)` — **on-demand only**; tracks are NOT cached.

### Hooks
- **`useLibrary()`** — inits `data` from `loadCache()`, `connection` = cached/empty. **No sync on mount.** `refresh()` runs `sync()`: `healthCheck()` → if live, `Promise.all` the four fetchers → if non-empty, `saveCache` + `setData` + `connection='live'`. Guarded so a live-but-empty response never wipes a good cache.
- **`useRecentPlays()`** — same pattern with its own cache key; also manual-refresh only.

### localStorage keys
`nostalge:data:v1` (library) · `nostalge:recent:v1` (recent plays) · `nostalge:discovery:shown:v1` (recently-shown discovery card ids) · `nostalge:theme` (`light`/`dark`).

## UI / navigation (`src/components/App.tsx`)
- **Tabs** (`Tab` in `BottomNav.tsx`): `discovery | crates | tags | stats | recent`. Bottom-nav order: **Discover, Crates, Tags, Stats, Recent**. Default tab: **discovery**.
- **Navigation stack**: `stack: Detail[]`, `Detail = { kind: 'artist'|'album'|'tag'; id }`. When `stack` is non-empty, App renders the matching detail view (in a `max-w-2xl` readable column) instead of the tab body; `back` pops. `changeTab` clears the stack, sets the tab, re-rolls the discovery seed when entering Discovery, scrolls to top.
- **`discoverySeed`** lives in `App` (not in `DiscoveryTab`) so the Discovery selection **survives drilling into a detail and pressing Back**; it re-rolls only on deliberate tab entry or Shuffle.
- **Masthead**: "Nostalge" kicker + tab title, a `ConnectionFlag` (syncing / live / "off the shelf" / "no signal"), plus `InstallButton`, `ThemeToggle`, and a spin-while-syncing Refresh button.
- **Responsive**: full-width container; grids scale 2 → sm:3 → md/lg:4–5 → xl:6 columns; detail pages capped at `max-w-2xl`.

## Discovery engine (`src/lib/discovery/`)
The Discovery tab is a **data engine kept separate from the UI**.
- `engine.ts` — `buildContext(data, now, seed)` precomputes `albumById`, `artistNameById`, and `albumPlays` (albumId → ascending epoch-ms timestamps), plus a seeded `rand` generators use to rotate their picks per shuffle. `selectCards(generators, ctx, seed, 20)` runs every generator in try/catch (a generator may return one card, an array of cards, or null), drops nulls, **forces in** `on-this-day`, then does **Efraimidis–Spirakis weighted sampling** (`weight = (0.25 + narrativeScore) * (recentlyShown ? 0.25 : 1)`, recency from `nostalge:discovery:shown:v1`, 7-day window), then a seeded (mulberry32) Fisher–Yates shuffle of the final 20. `DiscoveryTab` writes `recordShown` after render.
- `cards.ts` — `GENERATORS`, **32 total: 22 active, 10 dormant** (`() => null`). A generator returns a `DiscoveryCard` (headline, subheadline, optional big `metric`, 1–6 albums, CTA, `narrativeScore`), an array of cards (the tag/year families emit several per deal), or `null` to be skipped.
  - **Active** (from cached albums/artists/plays): On This Day, This Month That Year, Late Night, Morning Stack, Weekend, Sunday, Almost There, Century Club, First Listen Flashback, Forgotten Gems, Long Hiatus, One Summer, Fading Favourites, Fast Burner (plays/yr — *ownership proxied by first cached play*), The B-Side, The Grower, plus the non-recency families: Genre Spotlight (×3, rotating tag), Lucky Dip (×2, random pull from a rotating tag crate), Blind Pull (6 random sleeves), Class of YYYY (×2, year of first cached play), Pressed in YYYY (×2, Last.fm year tags as release years), The Underplayed, The Completist.
  - **Dormant** (wired in, always `null` until backend data exists): One Hit Wonders, Deep Cut Ratio, Never Finished, All Killer (need **per-track plays** — tracks aren't cached); From Somewhere New (no **artist country**); Decade Deep Dive (no **release year**); Short and Sweet, Commitment Test (no cached **album duration**); Loved But Unplayed, Sleeper Loved (no **"loved"** field).
- `DiscoveryTab.tsx` — runs the engine via `useMemo([data, seed])`, renders up to 5 `DiscoveryCard`s, Shuffle button (`onReroll` re-seeds), and a "come back soon" empty state when `< 3` cards have data.

> **Highest-value data-layer extension:** caching track-level plays would unlock the 4 per-track cards without any backend schema change. Country/year/duration/loved need new backend fields.

## Theming / design system (`src/styles/global.css`)
- **Tokens in `@theme`**: paper/ink palette (`--color-paper*`, `--color-ink*`, `--color-kraft`), riso accents (`--color-riso-red/olive/yellow/blue`), fonts (`--font-display` Bebas Neue, `--font-body` Archivo — loaded via Google Fonts in `Layout.astro`), `--radius-sticker`, `--shadow-ink`, `--nav-active-bg`.
- **Dark mode is a token swap**, not per-component variants. A `.dark {}` block overrides those custom properties; every component consumes token colors (`bg-paper`, `text-ink`, `border-ink`, etc.), so one class flip re-themes the whole app. `--shadow-ink` and `--nav-active-bg` are themed so the hard offset shadows and the selected-tab block still read on dark. `.dark .sleeve-blend` disables the multiply blend so cover art doesn't crush to black.
- **Zine component classes**: `.stamp-title`, `.label`, `.flyer` (hard border + offset shadow), `.aged::after` (multiply noise), `.price-sticker`, `.btn-press` (shadow collapses on `:active`), `.divider-card`. Utilities: `.tilt-l/.tilt-r`, `.pb-safe`, `.sleeve-blend`, `.card-in` (entrance anim, disabled under `prefers-reduced-motion`). Body has layered radial toner gradients + inline SVG grain.
- **Toggle**: pre-paint inline script in `Layout.astro` applies saved/system theme (avoids flash); `ThemeToggle.tsx` flips the `dark` class + persists + updates `theme-color` meta.

## PWA / service worker
- `@vite-pwa/astro` with `registerType: 'autoUpdate'`, `injectRegister: false`. Because vite-plugin-pwa's HTML injection doesn't run on Astro's generated pages, the **manifest link and SW registration are hand-wired in `Layout.astro`** (base-path aware).
- Workbox: `skipWaiting: true` + `clientsClaim: true` (new SW takes over open pages immediately), app-shell precache, and a `cover-art` CacheFirst runtime cache for images.
- Registration script tracks `hadController` (so a fresh install doesn't reload), reloads once on `controllerchange` (new build activates without a manual hard refresh), and calls `reg.update()` on `visibilitychange`.
- Manifest `scope`/`start_url`/`id` all pinned to `/nostalge-client/`.

## Build & deploy
- Scripts: `npm run dev` (astro dev, port 4321), `npm run build` (→ `./dist`), `npm run preview`, `npm run check` (astro check / typecheck).
- Env: `PUBLIC_POCKETBASE_URL` (client-exposed, baked at build; default in `.env.example` is a LAN IP).
- **CI** (`.github/workflows/deploy.yml`): on push to `main` (or manual dispatch) → `npm ci` → `npm run build` (reads `PUBLIC_POCKETBASE_URL` from a repo variable, else the bundled default) → `upload-pages-artifact` → `actions/deploy-pages`. **Official GitHub Pages deployment** (Pages "Source" must be set to "GitHub Actions"), not a `gh-pages` branch.
- After deploy, the auto-updating SW means clients pick up the new build on next open (no reinstall).

## Conventions & gotchas for the next contributor
- **Add a tab**: extend the `Tab` union + `ITEMS` in `BottomNav.tsx`, add a title in `App.tsx`'s `TAB_TITLES`, render it in the tab switch. Keep the grid at `grid-cols-5`.
- **Add a discovery card**: write a `CardGenerator` in `cards.ts` returning a `DiscoveryCard | null` and add it to `GENERATORS`. Enforce "enough data" inside the generator and return `null` otherwise.
- **New PocketBase field**: add it to the interface in `types.ts`, fetch it in `pb.ts` (respect the caps + `requestKey: null`), and it flows through the cache automatically.
- **Colors**: only touch `@theme` and the `.dark` block; never hardcode hex in components — use token utilities so dark mode keeps working.
- **Base path**: any new public asset URL must go through `import.meta.env.BASE_URL` (see `Layout.astro`) so it resolves under `/nostalge-client/`.
- Data reads must stay silent-failing and cache-first; **do not** reintroduce auto-sync on load (it was deliberately removed).
