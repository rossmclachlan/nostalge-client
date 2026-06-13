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

/* ------------------------------------------------------------------ */
/*  Discovery                                                          */
/* ------------------------------------------------------------------ */

export interface Discovery {
  forgottenAlbums: AlbumWithArtist[]
  forgottenArtists: Artist[]
  blindAlbums: AlbumWithArtist[]
  blindArtists: Artist[]
}

export function deriveDiscovery(data: MusicData): Discovery {
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

  // Forgotten gems: have been played, but not in the last 6 months.
  const forgottenAlbums = albums
    .filter((a) => a.play_count > 0)
    .map(decorate)
    .filter((a) => a.lastPlayed === null || a.lastPlayed < cutoff)
    .sort((a, b) => b.play_count - a.play_count)
    .slice(0, 24)

  const forgottenArtists = artists
    .filter((a) => a.play_count > 0)
    .filter((a) => {
      const last = artistLast.get(a.id)
      return last === undefined || last < cutoff
    })
    .sort((a, b) => b.play_count - a.play_count)
    .slice(0, 24)

  // Blind spots: never played.
  const blindAlbums = albums
    .filter((a) => a.play_count === 0)
    .map(decorate)
    .slice(0, 24)

  const blindArtists = artists.filter((a) => a.play_count === 0).slice(0, 24)

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
