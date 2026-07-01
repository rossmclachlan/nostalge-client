import type { Album, MusicData } from '../types'

/* ------------------------------------------------------------------ */
/*  Card model                                                         */
/* ------------------------------------------------------------------ */

export type CardCategory =
  | 'temporal'
  | 'milestone'
  | 'neglect'
  | 'geo'
  | 'loved'
  | 'calculated'

export interface CardAlbum {
  id: string
  title: string
  artistName: string
  imageUrl?: string
}

export interface DiscoveryCard {
  /** stable id, e.g. 'on-this-day' — used for recently-shown tracking */
  id: string
  category: CardCategory
  headline: string
  subheadline: string
  metric?: { value: string; label: string }
  albums: CardAlbum[]
  cta: string
  /** 0..1 — how strong the narrative hook is; steers selection weight */
  narrativeScore: number
}

export const CATEGORY_META: Record<
  CardCategory,
  { label: string; dot: string }
> = {
  temporal: { label: 'Temporal', dot: 'var(--color-riso-blue)' },
  milestone: { label: 'Milestone', dot: 'var(--color-riso-yellow)' },
  neglect: { label: 'Neglect', dot: 'var(--color-riso-red)' },
  geo: { label: 'Geography', dot: 'var(--color-riso-olive)' },
  loved: { label: 'Loved', dot: 'var(--color-riso-red)' },
  calculated: { label: 'Calculated', dot: 'var(--color-riso-olive)' },
}

/* ------------------------------------------------------------------ */
/*  Engine context — shared, pre-computed views over the library       */
/* ------------------------------------------------------------------ */

export interface EngineCtx {
  now: number
  albums: Album[]
  albumById: Map<string, Album>
  artistNameById: Map<string, string>
  /** albumId -> sorted (asc) epoch-ms timestamps of its cached plays */
  albumPlays: Map<string, number[]>
  toCardAlbum: (a: Album) => CardAlbum
}

export function buildContext(data: MusicData, now: number): EngineCtx {
  const albumById = new Map(data.albums.map((a) => [a.id, a]))
  const artistNameById = new Map(data.artists.map((a) => [a.id, a.name]))

  const albumPlays = new Map<string, number[]>()
  for (const p of data.plays) {
    if (!p.al) continue
    const t = new Date(p.at).getTime()
    if (Number.isNaN(t)) continue
    const arr = albumPlays.get(p.al)
    if (arr) arr.push(t)
    else albumPlays.set(p.al, [t])
  }
  for (const arr of albumPlays.values()) arr.sort((a, b) => a - b)

  const toCardAlbum = (a: Album): CardAlbum => ({
    id: a.id,
    title: a.title,
    artistName: artistNameById.get(a.artist) ?? 'Unknown',
    imageUrl: a.image_url || undefined,
  })

  return { now, albums: data.albums, albumById, artistNameById, albumPlays, toCardAlbum }
}

export type CardGenerator = (ctx: EngineCtx) => DiscoveryCard | null

/* ------------------------------------------------------------------ */
/*  Selection                                                          */
/* ------------------------------------------------------------------ */

const DAY = 86_400_000
const SHOWN_KEY = 'nostalge:discovery:shown:v1'

type ShownMap = Record<string, number>

export function loadShown(): ShownMap {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(SHOWN_KEY)
    return raw ? (JSON.parse(raw) as ShownMap) : {}
  } catch {
    return {}
  }
}

export function recordShown(ids: string[], now: number): void {
  if (typeof localStorage === 'undefined') return
  try {
    const map = loadShown()
    for (const id of ids) map[id] = now
    localStorage.setItem(SHOWN_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

/** mulberry32 seeded RNG factory. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Run every generator, drop nulls, then pick `count` cards with a seeded
 * weighted sample. Weight favours a strong narrative score and cards not
 * shown in the last 7 days. "On This Day" is always included when present.
 */
export function selectCards(
  generators: CardGenerator[],
  ctx: EngineCtx,
  seed: number,
  count = 5,
): DiscoveryCard[] {
  const cards: DiscoveryCard[] = []
  for (const gen of generators) {
    try {
      const card = gen(ctx)
      if (card) cards.push(card)
    } catch {
      // a misbehaving generator should never break the feed
    }
  }

  const shown = loadShown()
  const rand = rng(seed)

  const forced = cards.filter((c) => c.id === 'on-this-day')
  const pool = cards.filter((c) => c.id !== 'on-this-day')

  // Efraimidis–Spirakis weighted sampling without replacement.
  const keyed = pool.map((c) => {
    const shownAt = shown[c.id] ?? 0
    const recentlyShown = ctx.now - shownAt < 7 * DAY
    const weight = (0.25 + c.narrativeScore) * (recentlyShown ? 0.25 : 1)
    const key = Math.pow(rand(), 1 / Math.max(weight, 1e-6))
    return { c, key }
  })
  keyed.sort((a, b) => b.key - a.key)

  const picked = keyed.slice(0, Math.max(0, count - forced.length)).map((k) => k.c)
  const selected = [...forced, ...picked].slice(0, count)

  // Shuffle final display order (seeded), so it's not always OTD-first.
  for (let i = selected.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[selected[i], selected[j]] = [selected[j], selected[i]]
  }
  return selected
}
