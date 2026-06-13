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

## The four crates

- **Crates** — browse every artist as a card (album art or a generated
  initials placeholder), search client-side, then dig into an artist's sleeves
  and an album's tracklist, plays and "last spun" date.
- **Discovery** — *Forgotten Gems* (played before, but not in the last 6 months)
  and *Blind Spot* (filed away, never played).
- **Tags** — the collection sorted by genre / mood / era, shown as handwritten
  divider cards.
- **Stats** — big typographic numbers: top artists, top albums, busiest month.

## Data layer

On load the app:

1. Surfaces whatever is cached in `localStorage` immediately (works offline).
2. Runs a fast `/api/health` probe against PocketBase.
3. If it answers, fetches artists, albums, tags and recent plays, replaces the
   cache, and re-renders. If it doesn't, it silently keeps the cached view.

All PocketBase reads pass `{ requestKey: null }`, use paginated `getList()` (not
`getFullList()`), and are wrapped in try/catch that fails silently. See
`src/lib/pb.ts`, `src/lib/cache.ts` and `src/lib/useLibrary.ts`.

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
echo 'PUBLIC_POCKETBASE_URL=http://192.168.86.141:8095' > .env
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

`.github/workflows/deploy.yml` builds on push to `main` and publishes `./dist`
to the `gh-pages` branch (a `.nojekyll` file is emitted so GitHub Pages serves
the `_astro/` directory). The build reads `PUBLIC_POCKETBASE_URL` from a repo
variable of the same name, falling back to the bundled LAN address.

## Project structure

```
src/
├── components/        # React islands + the design system
│   ├── App.tsx        # root island: tabs + navigation stack
│   ├── crates/        # Crates tab, artist & album detail
│   ├── discovery/     # Forgotten Gems / Blind Spot
│   ├── tags/          # tag index + tag detail
│   └── stats/         # listening stats
├── lib/               # data layer: pb, cache, useLibrary, derive, format
├── layouts/Layout.astro
├── pages/index.astro  # mounts the App island
└── styles/global.css  # zine/record-store design tokens
```

## Stack

- **Astro 5** (`output: 'static'`) + **@astrojs/react**
- **React 18** islands + TypeScript
- **Tailwind CSS 4** (via `@tailwindcss/vite`)
- **PocketBase JS SDK** 0.21
