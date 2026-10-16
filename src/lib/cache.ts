import { plainText } from './format'
import type { Album, Artist, MusicData, TrackPlay } from './types'

/**
 * localStorage-backed cache for the music library. This is the source of
 * truth whenever PocketBase is unreachable, so reads must never throw.
 *
 * Tracks are stored under their own key: there can be tens of thousands of
 * them, so if that write hits the quota it fails on its own without taking
 * the (much smaller, more important) core library down with it.
 *
 * Artist bios and album write-ups are cut down to plain-text excerpts before
 * they're saved. The app only ever shows a few hundred characters of them,
 * and stored whole they can push the core library past the browser's ~5 MB
 * quota, which leaves nothing cached and "no signal" on every tab after a
 * reload.
 */

const KEY = 'nostalge:data:v1'
const TRACKS_KEY = 'nostalge:tracks:v1'

const EMPTY: MusicData = {
  artists: [],
  albums: [],
  tags: [],
  plays: [],
  tracks: [],
  fetchedAt: 0,
}

export function loadCache(): MusicData {
  if (typeof localStorage === 'undefined') return EMPTY
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<MusicData>
    let tracks: TrackPlay[] = []
    try {
      const rawTracks = localStorage.getItem(TRACKS_KEY)
      if (rawTracks) tracks = JSON.parse(rawTracks) as TrackPlay[]
    } catch {
      // tracks are optional — ignore a bad/absent tracks blob
    }
    return {
      artists: parsed.artists ?? [],
      albums: parsed.albums ?? [],
      tags: parsed.tags ?? [],
      plays: parsed.plays ?? [],
      tracks,
      fetchedAt: parsed.fetchedAt ?? 0,
    }
  } catch {
    return EMPTY
  }
}

/** Longest bio / write-up excerpt we keep (the UI shows at most 320). */
const EXCERPT = 400

function slimArtist(a: Artist): Artist {
  return a.bio ? { ...a, bio: plainText(a.bio, EXCERPT) } : a
}

function slimAlbum(a: Album): Album {
  return a.wiki_summary ? { ...a, wiki_summary: plainText(a.wiki_summary, EXCERPT) } : a
}

export function saveCache(data: MusicData): void {
  if (typeof localStorage === 'undefined') return
  const { tracks, ...rest } = data
  const core = JSON.stringify({
    ...rest,
    artists: rest.artists.map(slimArtist),
    albums: rest.albums.map(slimAlbum),
  })
  try {
    localStorage.setItem(KEY, core)
  } catch {
    // The previous sync's tracks blob may be what's using up the quota. The
    // core library matters more, so drop the tracks and try once more.
    try {
      localStorage.removeItem(TRACKS_KEY)
      localStorage.setItem(KEY, core)
    } catch {
      // Quota exceeded / private mode — degrade silently, the app still runs
      // off the in-memory copy for this session.
    }
  }
  try {
    localStorage.setItem(TRACKS_KEY, JSON.stringify(tracks ?? []))
  } catch {
    // Tracks are a nice-to-have (per-track cards); dropping them is fine.
  }
}

export function hasData(data: MusicData): boolean {
  return data.artists.length > 0 || data.albums.length > 0
}
