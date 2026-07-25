import { buildContext } from '../discovery/engine'
import type { Album, MusicData } from '../types'
import type { Candidate, PlaylistPlan, TimeOfDay } from './types'

/**
 * The deterministic middle of the playlist builder.
 *
 * Takes the plan the model produced and runs it against the cached library.
 * Pure: no network, no localStorage, no clock of its own — pass `now` and
 * `seed` in. Everything a playlist can contain comes out of here, which is why
 * the curator downstream cannot invent a track.
 *
 * Reuses `buildContext` from the discovery engine, so the collection-wide
 * exclusions (Screws, demos/bootlegs, excluded artists) apply here for free.
 */

/** How many candidates we are willing to hand the curator. */
const CANDIDATE_CAP = 150

/** Per-album / per-artist latitude at the candidate stage, so the curator gets
 *  a real choice of *which* track from a record. The plan's true limits are
 *  enforced when its picks are accepted (see curate.ts). */
const CANDIDATE_PER_ALBUM = 3

/** Roughly two years of neglect saturates the "forgotten" score. */
const NEGLECT_CEILING_DAYS = 730

const YEAR_TAG = /^(19|20)\d{2}$/

const TIME_WINDOWS: Record<Exclude<TimeOfDay, 'any'>, [number, number]> = {
  morning: [5, 11],
  afternoon: [12, 16],
  evening: [17, 21],
  late_night: [22, 4], // wraps midnight
}

/** Stable identity for a cached track: cached tracks carry no record id. */
export function trackRef(albumId: string, title: string): string {
  return `${albumId}|${title}`
}

const norm = (s: string) => s.trim().toLowerCase()

function inWindow(hour: number, [from, to]: [number, number]): boolean {
  return from <= to ? hour >= from && hour <= to : hour >= from || hour <= to
}

export function executePlan(
  plan: PlaylistPlan,
  data: MusicData,
  now: number,
  seed: number,
): Candidate[] {
  // No cached track data at all (an older cache, or a sync that dropped the
  // tracks blob) — there is nothing honest to build from.
  if (!data.tracks || data.tracks.length === 0) return []

  const ctx = buildContext(data, now, seed)
  const { filters, weights, constraints } = plan

  /* ---- tag lookups ------------------------------------------------- */

  const tagNameById = new Map(data.tags.map((t) => [t.id, t.name]))
  const tagIdByName = new Map(data.tags.map((t) => [norm(t.name), t.id]))

  const resolveTags = (names: string[]): Set<string> => {
    const out = new Set<string>()
    for (const name of names) {
      const id = tagIdByName.get(norm(name))
      if (id) out.add(id)
    }
    return out
  }

  const includeTags = resolveTags(filters.include_tags)
  const excludeTags = resolveTags(filters.exclude_tags)

  const includeArtists = new Set(filters.include_artists.map(norm))
  const excludeArtists = new Set(filters.exclude_artists.map(norm))

  /** An album's tags plus the tags of its artist — genre lives on both. */
  const tagsFor = (album: Album): string[] => {
    const artist = ctx.artistById.get(album.artist)
    return [...(album.tag_relations ?? []), ...(artist?.tag_relations ?? [])]
  }

  /** Release year, as far as the collection knows it: a Last.fm year tag. */
  const yearFor = (album: Album): number | null => {
    for (const id of tagsFor(album)) {
      const name = tagNameById.get(id)
      if (name && YEAR_TAG.test(name)) return Number(name)
    }
    return null
  }

  /* ---- play-count bands, as terciles of the whole collection -------- */

  const counts = ctx.albums.map((a) => a.play_count || 0).sort((a, b) => a - b)
  const at = (q: number) => counts[Math.floor(counts.length * q)] ?? 0
  const lowMax = at(0.33)
  const highMin = at(0.67)

  /* ---- album filtering --------------------------------------------- */

  const albums = ctx.albums.filter((album) => {
    const albumTags = tagsFor(album)
    if (includeTags.size > 0 && !albumTags.some((t) => includeTags.has(t))) return false
    if (excludeTags.size > 0 && albumTags.some((t) => excludeTags.has(t))) return false

    const artistName = norm(ctx.artistNameById.get(album.artist) ?? '')
    if (includeArtists.size > 0 && !includeArtists.has(artistName)) return false
    if (excludeArtists.has(artistName)) return false

    if (filters.year_from > 0 || filters.year_to > 0) {
      const year = yearFor(album)
      if (year === null) return false
      if (filters.year_from > 0 && year < filters.year_from) return false
      if (filters.year_to > 0 && year > filters.year_to) return false
    }

    const plays = album.play_count || 0
    if (filters.play_count_band === 'low' && plays > lowMax) return false
    if (filters.play_count_band === 'high' && plays < highMin) return false
    if (filters.play_count_band === 'medium' && (plays <= lowMax || plays >= highMin)) return false

    const stamps = ctx.albumPlays.get(album.id)
    const last = stamps && stamps.length > 0 ? stamps[stamps.length - 1] : null
    const { mode, days } = filters.last_played
    if (mode === 'never' && last !== null) return false
    if (mode === 'not_within_days' && last !== null && now - last < days * 86_400_000) return false
    if (mode === 'within_days' && (last === null || now - last > days * 86_400_000)) return false

    if (filters.time_of_day !== 'any') {
      const window = TIME_WINDOWS[filters.time_of_day]
      const played = stamps ?? []
      if (!played.some((t) => inWindow(new Date(t).getHours(), window))) return false
    }

    return true
  })

  /* ---- expand to tracks and score ----------------------------------- */

  const candidates: Candidate[] = []

  for (const album of albums) {
    const tracks = ctx.tracksByAlbum.get(album.id)
    if (!tracks || tracks.length === 0) continue

    const stamps = ctx.albumPlays.get(album.id)
    const last = stamps && stamps.length > 0 ? stamps[stamps.length - 1] : null
    const lastPlayedDays = last === null ? null : Math.floor((now - last) / 86_400_000)

    // Neglect: never played reads as fully forgotten.
    const neglect =
      lastPlayedDays === null ? 1 : Math.min(lastPlayedDays / NEGLECT_CEILING_DAYS, 1)

    const topTrackPlays = Math.max(...tracks.map((t) => t.p), 1)
    const tagNames = (album.tag_relations ?? [])
      .map((id) => tagNameById.get(id))
      .filter((n): n is string => Boolean(n))
      .slice(0, 4)

    const scored = tracks.map((t) => {
      // A quiet track on a record that gets played is the deep cut we want.
      const deepCut = 1 - t.p / topTrackPlays
      const score =
        1 +
        weights.neglect * neglect * 2 +
        weights.deep_cut * deepCut * 2 +
        ctx.rand() * 0.5 // seeded jitter, so a re-roll deals differently

      return { title: t.t, plays: t.p, score }
    })

    scored.sort((a, b) => b.score - a.score)

    for (const t of scored.slice(0, CANDIDATE_PER_ALBUM)) {
      candidates.push({
        ref: trackRef(album.id, t.title),
        albumId: album.id,
        artistId: album.artist,
        track: t.title,
        artist: ctx.artistNameById.get(album.artist) ?? 'Unknown',
        album: album.title,
        imageUrl: album.image_url || undefined,
        plays: t.plays,
        lastPlayedDays,
        tags: tagNames,
        score: t.score,
      })
    }
  }

  /* ---- thin out so one artist can't swamp the list ------------------ */

  // Round-robin by album: every record offers its best track before any record
  // offers a second. Straight score order would let one album eat an artist's
  // whole allowance, and the curator would lose the choice of *which* record.
  const byAlbum = new Map<string, Candidate[]>()
  for (const c of candidates) {
    const list = byAlbum.get(c.albumId)
    if (list) list.push(c)
    else byAlbum.set(c.albumId, [c])
  }
  for (const list of byAlbum.values()) list.sort((a, b) => b.score - a.score)

  const albums_ = [...byAlbum.values()].sort((a, b) => b[0].score - a[0].score)

  const artistRoom = Math.max(constraints.max_per_artist, 1) * 2
  const perArtist = new Map<string, number>()
  const out: Candidate[] = []

  for (let round = 0; round < CANDIDATE_PER_ALBUM && out.length < CANDIDATE_CAP; round++) {
    for (const list of albums_) {
      if (out.length >= CANDIDATE_CAP) break
      const c = list[round]
      if (!c) continue
      const used = perArtist.get(c.artistId) ?? 0
      if (used >= artistRoom) continue
      perArtist.set(c.artistId, used + 1)
      out.push(c)
    }
  }

  out.sort((a, b) => b.score - a.score)
  return out
}

/** Compact one candidate per line — a third of the tokens of JSON. */
export function candidateLines(candidates: Candidate[]): string {
  const rows = candidates.map((c) => {
    const age = c.lastPlayedDays === null ? 'never' : `${c.lastPlayedDays}d`
    return [c.ref, c.track, c.artist, c.album, `${c.plays} plays`, `last ${age}`, c.tags.join('/')]
      .join(' | ')
  })
  return ['ref | track | artist | album | plays | last played | tags', ...rows].join('\n')
}
