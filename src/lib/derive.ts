import type { Album, Artist, MusicData, PlayEvent, Tag } from './types'

/**
 * Pure derivations over the cached library — discovery surfaces and stats.
 * Everything works off whatever data we have, online or off.
 */

const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 6

/** Map of record id -> most recent play timestamp (epoch ms). */
function lastPlayedMap(plays: PlayEvent[], key: 'ar' | 'al'): Map<string, number> {
  const map = new Map<string, number>()
  for (const p of plays) {
    const id = p[key]
    if (!id) continue
    const t = new Date(p.at).getTime()
    if (Number.isNaN(t)) continue
    const prev = map.get(id)
    if (prev === undefined || t > prev) map.set(id, t)
  }
  return map
}

export interface AlbumWithArtist extends Album {
  artistName: string
  lastPlayed: number | null
}

/** id -> artist name lookup. */
function artistNameMap(artists: Artist[]): Map<string, string> {
  return new Map(artists.map((a) => [a.id, a.name]))
}

/** Deterministic shuffle (Fisher–Yates seeded with mulberry32). A given
 *  seed always yields the same order, so the picks stay stable while the
 *  tab is open and only change when the seed is re-rolled. */
function seededShuffle<T>(input: T[], seed: number): T[] {
  const arr = [...input]
  let s = seed >>> 0
  const rand = () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** Take a varied sample: keep the strongest `poolSize` candidates (so a
 *  "gem" stays a gem), then shuffle that pool and pick `count`. */
function sample<T>(ranked: T[], seed: number, count: number, poolSize: number): T[] {
  const pool = ranked.slice(0, poolSize)
  return seededShuffle(pool, seed).slice(0, count)
}

/* ------------------------------------------------------------------ */
/*  Discovery                                                          */
/* ------------------------------------------------------------------ */

export interface Discovery {
  forgottenAlbums: AlbumWithArtist[]
  forgottenArtists: Artist[]
  blindAlbums: AlbumWithArtist[]
  blindArtists: Artist[]
}

/**
 * Discovery surfaces. `seed` mixes up which records are shown — pass a fresh
 * value (e.g. on mount or a "dig again" tap) to get a different selection
 * each time rather than the same top-by-plays list.
 */
export function deriveDiscovery(data: MusicData, seed = 1): Discovery {
  const { albums, artists, plays } = data
  const artistNames = artistNameMap(artists)
  const albumLast = lastPlayedMap(plays, 'al')
  const artistLast = lastPlayedMap(plays, 'ar')
  const cutoff = Date.now() - SIX_MONTHS_MS

  const decorate = (a: Album): AlbumWithArtist => ({
    ...a,
    artistName: artistNames.get(a.artist) ?? 'Unknown',
    lastPlayed: albumLast.get(a.id) ?? null,
  })

  // Forgotten gems: played before, but not in the last 6 months. Draw a
  // varied sample from the most-played eligible records so it changes each
  // visit while still surfacing genuine favourites.
  const forgottenAlbumsRanked = albums
    .filter((a) => a.play_count > 0)
    .map(decorate)
    .filter((a) => a.lastPlayed === null || a.lastPlayed < cutoff)
    .sort((a, b) => b.play_count - a.play_count)
  const forgottenAlbums = sample(forgottenAlbumsRanked, seed, 24, 120)

  const forgottenArtistsRanked = artists
    .filter((a) => a.play_count > 0)
    .filter((a) => {
      const last = artistLast.get(a.id)
      return last === undefined || last < cutoff
    })
    .sort((a, b) => b.play_count - a.play_count)
  const forgottenArtists = sample(forgottenArtistsRanked, seed ^ 0x9e3779b9, 24, 120)

  // Blind spots: never played — fully shuffled, no ranking to favour.
  const blindAlbums = seededShuffle(
    albums.filter((a) => a.play_count === 0).map(decorate),
    seed ^ 0x85ebca6b,
  ).slice(0, 24)

  const blindArtists = seededShuffle(
    artists.filter((a) => a.play_count === 0),
    seed ^ 0xc2b2ae35,
  ).slice(0, 24)

  return { forgottenAlbums, forgottenArtists, blindAlbums, blindArtists }
}

/* ------------------------------------------------------------------ */
/*  Tags                                                               */
/* ------------------------------------------------------------------ */

export function albumsForTag(data: MusicData, tagId: string): AlbumWithArtist[] {
  const artistNames = artistNameMap(data.artists)
  const albumLast = lastPlayedMap(data.plays, 'al')
  return data.albums
    .filter((a) => a.tag_relations?.includes(tagId))
    .map((a) => ({
      ...a,
      artistName: artistNames.get(a.artist) ?? 'Unknown',
      lastPlayed: albumLast.get(a.id) ?? null,
    }))
    .sort((a, b) => b.play_count - a.play_count)
}

export function artistsForTag(data: MusicData, tagId: string): Artist[] {
  return data.artists
    .filter((a) => a.tag_relations?.includes(tagId))
    .sort((a, b) => b.play_count - a.play_count)
}

/** Tags ordered by usage, dropping empties. */
export function sortedTags(data: MusicData): Tag[] {
  return [...data.tags]
    .filter((t) => t.name)
    .sort((a, b) => (b.usage_count ?? 0) - (a.usage_count ?? 0))
}

/* ------------------------------------------------------------------ */
/*  Crates                                                             */
/* ------------------------------------------------------------------ */

export function albumsForArtist(data: MusicData, artistId: string): AlbumWithArtist[] {
  const albumLast = lastPlayedMap(data.plays, 'al')
  const name = data.artists.find((a) => a.id === artistId)?.name ?? 'Unknown'
  return data.albums
    .filter((a) => a.artist === artistId)
    .map((a) => ({ ...a, artistName: name, lastPlayed: albumLast.get(a.id) ?? null }))
    .sort((a, b) => b.play_count - a.play_count)
}

export function lastPlayedForAlbum(data: MusicData, albumId: string): number | null {
  return lastPlayedMap(data.plays, 'al').get(albumId) ?? null
}

/* ------------------------------------------------------------------ */
/*  Stats                                                              */
/* ------------------------------------------------------------------ */

export interface Stats {
  totalArtists: number
  totalAlbums: number
  totalPlays: number
  topArtists: Artist[]
  topAlbums: AlbumWithArtist[]
  busiestMonth: { label: string; count: number } | null
  windowPlays: number
}

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

export function deriveStats(data: MusicData): Stats {
  const { artists, albums, plays } = data
  const artistNames = artistNameMap(artists)

  const topArtists = [...artists]
    .sort((a, b) => b.play_count - a.play_count)
    .slice(0, 10)

  const topAlbums: AlbumWithArtist[] = [...albums]
    .sort((a, b) => b.play_count - a.play_count)
    .slice(0, 10)
    .map((a) => ({
      ...a,
      artistName: artistNames.get(a.artist) ?? 'Unknown',
      lastPlayed: null,
    }))

  // Busiest month from the cached play window.
  const buckets = new Map<string, { count: number; m: number; y: number }>()
  for (const p of plays) {
    const d = new Date(p.at)
    if (Number.isNaN(d.getTime())) continue
    const k = `${d.getFullYear()}-${d.getMonth()}`
    const b = buckets.get(k) ?? { count: 0, m: d.getMonth(), y: d.getFullYear() }
    b.count += 1
    buckets.set(k, b)
  }
  let busiestMonth: Stats['busiestMonth'] = null
  for (const b of buckets.values()) {
    if (!busiestMonth || b.count > busiestMonth.count) {
      busiestMonth = { label: `${MONTHS_SHORT[b.m]} ${b.y}`, count: b.count }
    }
  }

  const totalPlays = artists.reduce((sum, a) => sum + (a.play_count || 0), 0)

  return {
    totalArtists: artists.length,
    totalAlbums: albums.length,
    totalPlays,
    topArtists,
    topAlbums,
    busiestMonth,
    windowPlays: plays.length,
  }
}
