import type PocketBase from 'pocketbase'
import type { Artist, Album, Scrobble, Tag, Track } from '@/types/pocketbase'
import { seededRandom, seededShuffle } from '@/lib/discovery'

// ---------------------------------------------------------------------------
// Expanded relation types
// ---------------------------------------------------------------------------

type ScrobbleExpanded = Scrobble & {
  expand?: {
    track?: Track & {
      expand?: {
        artist?: Artist
        album?: Album
      }
    }
  }
}

type AlbumWithArtist = Album & {
  expand?: { artist?: Artist }
}

// ---------------------------------------------------------------------------
// fetchOnThisDay
// ---------------------------------------------------------------------------

export interface OnThisDayGroup {
  year: number
  scrobbles: ScrobbleExpanded[]
}

/**
 * Fetch scrobbles where scrobbled_at matches the given month+day from any
 * previous year, expanding track/artist/album relations. Returns the top 2-3
 * years (by scrobble count) grouped by year.
 */
export async function fetchOnThisDay(
  pb: PocketBase,
  month: number,
  day: number,
): Promise<OnThisDayGroup[]> {
  const currentYear = new Date().getFullYear()

  // Build date range filters for each previous year, widened by ±1 day to
  // account for timezone differences. Scrobbles are stored in UTC, so e.g.
  // "Feb 27 at 11pm Pacific" is stored as "Feb 28 UTC". We fetch a wider
  // window and then filter client-side by the user's local date.
  const yearFilters: string[] = []
  for (let year = currentYear - 1; year >= currentYear - 10; year--) {
    const prevDay = new Date(year, month - 1, day - 1)
    const dayAfterNext = new Date(year, month - 1, day + 2)
    const startDate = `${prevDay.getFullYear()}-${String(prevDay.getMonth() + 1).padStart(2, '0')}-${String(prevDay.getDate()).padStart(2, '0')} 00:00:00`
    const endDate = `${dayAfterNext.getFullYear()}-${String(dayAfterNext.getMonth() + 1).padStart(2, '0')}-${String(dayAfterNext.getDate()).padStart(2, '0')} 00:00:00`
    yearFilters.push(`(scrobbled_at >= '${startDate}' && scrobbled_at < '${endDate}')`)
  }

  const filter = yearFilters.join(' || ')

  // Use getList instead of getFullList to avoid the implicit skipTotal: true
  // that getFullList sets internally, which causes totalItems to be 0 and can
  // break pagination with complex OR filters.
  const result = await pb.collection('scrobbles').getList<ScrobbleExpanded>(1, 500, {
    filter,
    sort: '-scrobbled_at',
    expand: 'track,track.artist,track.album',
    requestKey: null,
  })

  // Filter client-side: only keep scrobbles whose local date matches the
  // target month/day (the wider UTC window may include adjacent-day scrobbles).
  const filtered = result.items.filter((scrobble) => {
    const local = new Date(scrobble.scrobbled_at)
    return local.getMonth() + 1 === month && local.getDate() === day
  })

  // Group by year (using local time for consistency)
  const groups = new Map<number, ScrobbleExpanded[]>()
  for (const scrobble of filtered) {
    const year = new Date(scrobble.scrobbled_at).getFullYear()
    if (!groups.has(year)) {
      groups.set(year, [])
    }
    groups.get(year)!.push(scrobble)
  }

  // Return top 3 years by scrobble count, then sorted most recent first
  return Array.from(groups.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 3)
    .sort((a, b) => b[0] - a[0])
    .map(([year, scrobbles]) => ({ year, scrobbles }))
}

// ---------------------------------------------------------------------------
// fetchDeepCuts
// ---------------------------------------------------------------------------

/**
 * Fetch albums with play_count between 10 and 50 ("deep cuts"), then use
 * seeded shuffle to deterministically pick 10.
 */
export async function fetchDeepCuts(
  pb: PocketBase,
  seed: number,
): Promise<AlbumWithArtist[]> {
  const result = await pb.collection('albums').getFullList<AlbumWithArtist>({
    filter: 'play_count >= 10 && play_count <= 50',
    expand: 'artist',
    requestKey: null,
  })

  const shuffled = seededShuffle(result, seed)
  return shuffled.slice(0, 10)
}

// ---------------------------------------------------------------------------
// fetchForgottenFavorites
// ---------------------------------------------------------------------------

/**
 * Fetch top artists (by play_count) that haven't been scrobbled recently.
 * Grabs top 200 by play count, then the 50 most recent scrobble artist names,
 * and returns top artists NOT in that recent list (seeded-shuffled, pick 10).
 */
export async function fetchForgottenFavorites(
  pb: PocketBase,
  seed: number,
): Promise<Artist[]> {
  // Fetch top 200 artists by play count
  const topArtists = await pb.collection('artists').getList<Artist>(1, 200, {
    sort: '-play_count',
    requestKey: null,
  })

  // Fetch 50 most recent scrobbles to determine recently-played artists
  const recentScrobbles = await pb
    .collection('scrobbles')
    .getList<ScrobbleExpanded>(1, 50, {
      sort: '-scrobbled_at',
      expand: 'track,track.artist',
      requestKey: null,
    })

  // Collect recent artist names
  const recentArtistNames = new Set<string>()
  for (const s of recentScrobbles.items) {
    const artistName = s.expand?.track?.expand?.artist?.name
    if (artistName) {
      recentArtistNames.add(artistName)
    }
  }

  // Filter to artists not recently scrobbled
  const forgotten = topArtists.items.filter(
    (a) => !recentArtistNames.has(a.name),
  )

  const shuffled = seededShuffle(forgotten, seed)
  return shuffled.slice(0, 10)
}

// ---------------------------------------------------------------------------
// fetchGenreDive
// ---------------------------------------------------------------------------

export interface GenreDiveResult {
  tag: Tag
  artists: Artist[]
  albums: AlbumWithArtist[]
}

/**
 * Pick a deterministic "genre of the day" from the top 50 tags, then fetch
 * artists and albums tagged with it.
 */
export async function fetchGenreDive(
  pb: PocketBase,
  seed: number,
): Promise<GenreDiveResult> {
  // Fetch top 50 tags
  const tags = await pb.collection('tags').getList<Tag>(1, 50, {
    sort: '-usage_count',
    requestKey: null,
  })

  // Pick one deterministically
  const index = Math.floor(seededRandom(seed) * tags.items.length)
  const tag = tags.items[index]

  // Fetch artists and albums with this tag
  const [artists, albums] = await Promise.all([
    pb.collection('artists').getList<Artist>(1, 10, {
      filter: `tag_relations~"${tag.id}"`,
      sort: '-play_count',
      requestKey: null,
    }),
    pb.collection('albums').getList<AlbumWithArtist>(1, 10, {
      filter: `tag_relations~"${tag.id}"`,
      sort: '-play_count',
      expand: 'artist',
      requestKey: null,
    }),
  ])

  return {
    tag,
    artists: artists.items,
    albums: albums.items,
  }
}

// ---------------------------------------------------------------------------
// fetchRandomAlbum
// ---------------------------------------------------------------------------

/**
 * Pick a deterministic "random album of the day" by using the seed to choose
 * an offset into the full album collection.
 */
export async function fetchRandomAlbum(
  pb: PocketBase,
  seed: number,
): Promise<AlbumWithArtist | null> {
  // Get total count with a minimal request
  const countResult = await pb.collection('albums').getList(1, 1, {
    requestKey: null,
  })
  const total = countResult.totalItems
  if (total === 0) return null

  // Deterministic offset from seed
  const offset = Math.floor(seededRandom(seed) * total)
  const page = offset + 1 // PocketBase pages are 1-indexed

  const result = await pb.collection('albums').getList<AlbumWithArtist>(page, 1, {
    expand: 'artist',
    requestKey: null,
  })

  return result.items[0] ?? null
}
