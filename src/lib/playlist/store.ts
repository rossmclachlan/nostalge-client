import type { Playlist } from './types'

/**
 * localStorage for saved playlists. Same rules as `cache.ts`: reads and writes
 * never throw, and a corrupt blob degrades to an empty shelf rather than a
 * broken tab.
 */

const KEY = 'nostalge:playlists:v1'

/** Plenty for a personal shelf, and keeps the blob well clear of the quota. */
const MAX_SAVED = 50

export function loadPlaylists(): Playlist[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed as Playlist[]
  } catch {
    return []
  }
}

function write(list: Playlist[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_SAVED)))
  } catch {
    // Quota / private mode — the playlist still exists in memory for this session.
  }
}

/** Newest first. */
export function savePlaylist(playlist: Playlist): Playlist[] {
  const next = [playlist, ...loadPlaylists().filter((p) => p.id !== playlist.id)]
  write(next)
  return next.slice(0, MAX_SAVED)
}

export function deletePlaylist(id: string): Playlist[] {
  const next = loadPlaylists().filter((p) => p.id !== id)
  write(next)
  return next
}

export function newPlaylistId(): string {
  return `pl_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`
}
