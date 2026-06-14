import PocketBase from 'pocketbase'
import type { Album, Artist, PlayEvent, RecentPlay, Scrobble, Tag, Track } from './types'

/**
 * PocketBase lives on the home LAN and is only reachable some of the time.
 * Every read here follows the same rules:
 *   - pass `{ requestKey: null }` so the SDK never auto-cancels a request
 *   - use `getList()` (paginated), never `getFullList()`
 *   - wrap everything in try/catch and fail *silently* — the caller falls
 *     back to whatever is cached locally.
 */

const POCKETBASE_URL =
  import.meta.env.PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090'

export const pb = new PocketBase(POCKETBASE_URL)
pb.autoCancellation(false)

/** How much we are willing to pull into localStorage (kept bounded). */
const CAPS = {
  artists: 1000,
  albums: 2000,
  tags: 300,
  plays: 4000,
}
const PER_PAGE = 200

/**
 * Lightweight liveness probe. Resolves to true only if the PocketBase
 * health endpoint answers quickly. Never throws.
 */
export async function healthCheck(timeoutMs = 2500): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${POCKETBASE_URL}/api/health`, {
      signal: controller.signal,
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** Pull successive pages until we hit the cap or run out of records. */
async function fetchPaged<T>(
  collection: string,
  cap: number,
  options: Record<string, unknown>,
): Promise<T[]> {
  const out: T[] = []
  let page = 1
  try {
    while (out.length < cap) {
      const result = await pb
        .collection(collection)
        .getList<T>(page, PER_PAGE, { requestKey: null, ...options })
      out.push(...result.items)
      if (page >= result.totalPages || result.items.length === 0) break
      page += 1
    }
  } catch {
    // Silent: return whatever we managed to gather (possibly nothing).
  }
  return out.slice(0, cap)
}

export function fetchArtists(): Promise<Artist[]> {
  return fetchPaged<Artist>('artists', CAPS.artists, { sort: '-play_count' })
}

export function fetchAlbums(): Promise<Album[]> {
  return fetchPaged<Album>('albums', CAPS.albums, { sort: '-play_count' })
}

export function fetchTags(): Promise<Tag[]> {
  return fetchPaged<Tag>('tags', CAPS.tags, { sort: '-usage_count' })
}

type ScrobbleExpanded = Scrobble & {
  expand?: {
    track?: Track & { expand?: { artist?: Artist; album?: Album } }
  }
}

/**
 * Tracklist for a single album, fetched on demand (we don't cache every
 * track). Returns [] when offline or on any error.
 */
export async function fetchTracksForAlbum(albumId: string): Promise<Track[]> {
  try {
    const result = await pb.collection('tracks').getList<Track>(1, 100, {
      filter: `album = "${albumId}"`,
      sort: '-play_count',
      requestKey: null,
    })
    return result.items
  } catch {
    return []
  }
}

/**
 * Most recent scrobbles with display details, newest first. Used by the
 * Recent tab as a live "is the NAS still scrobbling?" check. Returns [] when
 * offline or on any error.
 */
export async function fetchRecentPlays(limit = 100): Promise<RecentPlay[]> {
  try {
    const res = await pb.collection('scrobbles').getList<ScrobbleExpanded>(1, limit, {
      sort: '-scrobbled_at',
      expand: 'track,track.artist,track.album',
      requestKey: null,
    })
    return res.items.map((s) => ({
      id: s.id,
      track: s.expand?.track?.title ?? 'Unknown track',
      artist: s.expand?.track?.expand?.artist?.name ?? '',
      album: s.expand?.track?.expand?.album?.title ?? '',
      at: s.scrobbled_at,
    }))
  } catch {
    return []
  }
}

/** Recent scrobbles, slimmed to artist/album id + timestamp. */
export async function fetchPlays(): Promise<PlayEvent[]> {
  const rows = await fetchPaged<ScrobbleExpanded>('scrobbles', CAPS.plays, {
    sort: '-scrobbled_at',
    expand: 'track,track.artist,track.album',
  })
  return rows
    .map((s) => ({
      ar: s.expand?.track?.expand?.artist?.id ?? '',
      al: s.expand?.track?.expand?.album?.id ?? '',
      at: s.scrobbled_at,
    }))
    .filter((p) => p.ar || p.al)
}
