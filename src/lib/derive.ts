import type { Album, Artist, MusicData, PlayEvent, Tag } from './types'

/**
 * Pure derivations over the cached library — used by Tags, Crates and Stats.
 * Everything works off whatever data we have, online or off.
 */

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

/** Every album decorated with artist name + last-played, for the Crates grid. */
export function allAlbums(data: MusicData): AlbumWithArtist[] {
  const names = artistNameMap(data.artists)
  const albumLast = lastPlayedMap(data.plays, 'al')
  return data.albums.map((a) => ({
    ...a,
    artistName: names.get(a.artist) ?? 'Unknown',
    lastPlayed: albumLast.get(a.id) ?? null,
  }))
}

export function albumsForArtist(data: MusicData, artistId: string): AlbumWithArtist[] {
  const albumLast = lastPlayedMap(data.plays, 'al')
  const name = data.artists.find((a) => a.id === artistId)?.name ?? 'Unknown'
  return data.albums
    .filter((a) => a.artist === artistId)
    .map((a) => ({ ...a, artistName: name, lastPlayed: albumLast.get(a.id) ?? null }))
    .sort((a, b) => b.play_count - a.play_count)
}

/**
 * Records that share the most tags with `albumId`, by other artists: the
 * "kindred records" strip on the record page. Ties go to the more played.
 */
export function kindredAlbums(data: MusicData, albumId: string, limit = 12): AlbumWithArtist[] {
  const album = data.albums.find((a) => a.id === albumId)
  const tags = new Set(album?.tag_relations ?? [])
  if (!album || tags.size === 0) return []
  const names = artistNameMap(data.artists)
  const albumLast = lastPlayedMap(data.plays, 'al')
  return data.albums
    .filter((a) => a.artist !== album.artist)
    .map((a) => ({ a, shared: (a.tag_relations ?? []).filter((t) => tags.has(t)).length }))
    .filter(({ shared }) => shared > 0)
    .sort((x, y) => y.shared - x.shared || y.a.play_count - x.a.play_count)
    .slice(0, limit)
    .map(({ a }) => ({
      ...a,
      artistName: names.get(a.artist) ?? 'Unknown',
      lastPlayed: albumLast.get(a.id) ?? null,
    }))
}

/**
 * The artist's similar artists that are in the library ("filed near").
 * similar_artists entries may be record ids, mbids or names.
 */
export function similarArtists(data: MusicData, artistId: string): Artist[] {
  const artist = data.artists.find((a) => a.id === artistId)
  if (!artist?.similar_artists?.length) return []
  const byId = new Map(data.artists.map((a) => [a.id, a]))
  const byMbid = new Map(data.artists.filter((a) => a.mbid).map((a) => [a.mbid, a]))
  const byName = new Map(data.artists.map((a) => [a.name.toLowerCase(), a]))
  const out: Artist[] = []
  const seen = new Set([artistId])
  for (const key of artist.similar_artists) {
    const k = String(key).trim()
    const hit = byId.get(k) ?? byMbid.get(k) ?? byName.get(k.toLowerCase())
    if (hit && !seen.has(hit.id)) {
      seen.add(hit.id)
      out.push(hit)
    }
  }
  return out
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
