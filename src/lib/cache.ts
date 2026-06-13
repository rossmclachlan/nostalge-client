import type { MusicData } from './types'

/**
 * localStorage-backed cache for the music library. This is the source of
 * truth whenever PocketBase is unreachable, so reads must never throw.
 */

const KEY = 'nostalge:data:v1'

const EMPTY: MusicData = {
  artists: [],
  albums: [],
  tags: [],
  plays: [],
  fetchedAt: 0,
}

export function loadCache(): MusicData {
  if (typeof localStorage === 'undefined') return EMPTY
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<MusicData>
    return {
      artists: parsed.artists ?? [],
      albums: parsed.albums ?? [],
      tags: parsed.tags ?? [],
      plays: parsed.plays ?? [],
      fetchedAt: parsed.fetchedAt ?? 0,
    }
  } catch {
    return EMPTY
  }
}

export function saveCache(data: MusicData): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // Quota exceeded / private mode — degrade silently, the app still runs
    // off the in-memory copy for this session.
  }
}

export function hasData(data: MusicData): boolean {
  return data.artists.length > 0 || data.albums.length > 0
}
