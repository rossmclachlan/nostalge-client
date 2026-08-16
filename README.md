# nostalge-client

A mobile-first web app for **rediscovering your own record collection** — built
to feel like flipping through the crates at an independent record store rather
than scrolling a streaming app.

It reads from a self-hosted [PocketBase](https://pocketbase.io) backend that
lives on your home network. When that backend is reachable it pulls fresh data
and caches it locally; when it isn't, the app loads instantly from the cache and
degrades gracefully — it never shows a broken or error state.

Built with **Astro** (static output) + **React islands**, **TypeScript**, and
**Tailwind CSS**. The design system is hand-rolled — no UI component libraries.

> For a technical deep-dive (data flow, modules, discovery engine, theming,
> PWA, deploy), see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## The four tabs

Organised by what you actually want at the moment you open the app:

- **Discover** — *be told what to play.* Generated cards pulled from your listening
  history: forgotten gems, long hiatuses, records that first hit the crate in a given
  year. The artwork is the card; tap a sleeve to open the record.
- **Library** — *find something specific.* Two indexes into the same shelf:
  **Crates** (every album as a card, searchable client-side) and **Tags** (the
  collection sorted by genre / mood / era, as handwritten divider cards).
- **Sets** — *ask for a playlist in words.* See below.
- **History** — *look back.* The same facts at two zoom levels: **Recent** (the raw
  scrobble feed plus sync status) and **Stats** (top artists, top albums, busiest
  month).

Library and History switch between their two views with a small segmented control at
the top of the tab.

## Sets — playlists in plain language

Type *"something quiet I haven't played in years"* and get a sequenced tracklist with a
liner note explaining why those records, together, now.

It runs in three stages, and the middle one is ordinary code:

1. **Plan** — the model turns the sentence into a *query* over the collection (tags, play
   counts, recency, era).
2. **Dig** — that query runs locally against the cached library.
3. **Sequence** — the model orders the real tracks it was handed and writes the note.

The model never names a track from memory: it can only choose from what step 2 found, and
anything else is discarded. **Every track in a playlist is a record you own.**

The taste is built in — sequencing arc, no more than a couple of tracks per artist, deep
cuts over singles, and a bias toward records that have been sitting on the shelf. You don't
have to prompt well to get something good.

### Setting it up

Making a playlist calls the Gemini API, so it needs a key. There is no server here to
hold one, so the key stays in your own browser (`localStorage`) and goes straight to
Google. The Sets tab asks for it once.

The key comes from [aistudio.google.com](https://aistudio.google.com/apikey) and is an
**API key** — billed separately from any Gemini subscription, which doesn't grant API
access. Expect roughly **2¢ per playlist** on `gemini-3.7-flash`: about 10k input tokens
plus 2–7k output, at its introductory $0.75/$3.75 per million (rising to $1.50/$7.50 on
1 January 2027).

Saved playlists live in `localStorage` and open offline — only *building* one needs the
network. The rest of the app is unaffected if you never set a key.

## Data layer

On load the app:

1. Surfaces whatever is cached in `localStorage` immediately (works offline).
2. Runs a fast `/api/health` probe against PocketBase.
3. If it answers, fetches artists, albums, tags and recent plays, replaces the
   cache, and re-renders. If it doesn't, it silently keeps the cached view.

All PocketBase reads pass `{ requestKey: null }`, use paginated `getList()` (not
`getFullList()`), and are wrapped in try/catch that fails silently. See
`src/lib/pb.ts`, `src/lib/cache.ts` and `src/lib/useLibrary.ts`.

## Installable (PWA)

The app ships a web manifest and a Workbox service worker (`@vite-pwa/astro`),
so on **Android / Chromium** you can "Add to home screen" for a standalone,
full-screen experience. An **Install** button appears in the masthead when the
browser reports the app is installable. The service worker precaches the app
shell (launches offline) and runtime-caches cover art so artwork survives
off-network. iOS isn't a target for now.

The manifest link and SW registration are wired explicitly in
`src/layouts/Layout.astro` (base-path aware), since vite-plugin-pwa's
auto-injection doesn't run against Astro's generated pages.

## Prerequisites

- The [music-cms-mvp](https://github.com/mclachlanr/music-cms-mvp) backend
  running on your local network, with public read access enabled on the
  `artists`, `albums`, `tracks`, `scrobbles` and `tags` collections.
- Node.js 20+

## Setup

```bash
git clone https://github.com/rossmclachlan/nostalge-client.git
cd nostalge-client
npm install
```

Point the app at your PocketBase instance (use your server's LAN IP):

```bash
echo 'PUBLIC_POCKETBASE_URL=http://192.168.68.52:8095' > .env
```

> The variable is `PUBLIC_`-prefixed so Astro exposes it to the client bundle.

## Development

```bash
npm run dev            # http://localhost:4321/nostalge-client
npm run dev -- --host  # expose on your LAN to test on a phone
```

The app loads even with no backend reachable — you'll see empty/welcome screens
until data syncs.

## Build & preview

```bash
npm run build      # static output to ./dist
npm run preview
npm run check      # astro check (type checking)
```

## Deployment (GitHub Pages)

`astro.config.mjs` sets `output: 'static'` and `base: '/nostalge-client'` so
assets resolve under `https://<user>.github.io/nostalge-client/`.

`.github/workflows/deploy.yml` builds on push to `main` and deploys via the
official GitHub Pages action (`actions/deploy-pages`), so the repo's
**Settings → Pages → Source** must be set to **"GitHub Actions"**. The build
reads `PUBLIC_POCKETBASE_URL` from a repo variable of the same name, falling
back to the bundled LAN address.

## Project structure

```
src/
├── components/        # React islands + the design system
│   ├── App.tsx        # root island: tabs + navigation stack
│   ├── crates/        # Crates tab, artist & album detail
│   ├── discovery/     # Forgotten Gems / Blind Spot
│   ├── playlists/     # Sets tab: prompt, build panel, playlist detail
│   ├── tags/          # tag index + tag detail
│   └── stats/         # listening stats
├── lib/               # data layer: pb, cache, useLibrary, derive, format
│   └── playlist/      # plan -> execute -> curate, and the taste instructions
├── layouts/Layout.astro
├── pages/index.astro  # mounts the App island
└── styles/global.css  # zine/record-store design tokens
```

## Stack

- **Astro 5** (`output: 'static'`) + **@astrojs/react**
- **React 18** islands + TypeScript
- **Tailwind CSS 4** (via `@tailwindcss/vite`)
- **PocketBase JS SDK** 0.21
