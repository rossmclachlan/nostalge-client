import { callJson } from './gemini'
import { candidateLines } from './execute'
import { normaliseCurated } from './normalise'
import { PLAYLIST_SCHEMA } from './schema'
import { CURATOR_TASTE } from './taste'
import type { Candidate, PlaylistEntry, PlaylistPlan, RunFailure } from './types'

/**
 * Stage three: sequence real candidates into a playlist.
 *
 * This is where the guarantee is enforced. The curator is handed a list of refs
 * and may only return refs from it; anything else is dropped here rather than
 * shown to the listener. The plan's per-artist and per-album limits are applied
 * on acceptance too, so a playlist can never violate its own brief.
 */

export interface CuratedPlaylist {
  title: string
  linerNote: string
  entries: PlaylistEntry[]
}

export async function curatePlaylist(
  prompt: string,
  plan: PlaylistPlan,
  candidates: Candidate[],
): Promise<{ ok: true; playlist: CuratedPlaylist } | { ok: false; failure: RunFailure }> {
  if (candidates.length === 0) return { ok: false, failure: 'empty' }

  const brief = [
    `The listener asked for: "${prompt}"`,
    '',
    `Intent: ${plan.intent}`,
    `Target length: ${plan.length.tracks} tracks.`,
    `Arc: ${plan.sequencing.arc}.`,
    plan.sequencing.opener_note && `Opening: ${plan.sequencing.opener_note}`,
    plan.sequencing.closer_note && `Closing: ${plan.sequencing.closer_note}`,
    `At most ${plan.constraints.max_per_artist} track(s) per artist and ${plan.constraints.max_per_album} per album.`,
    '',
    `## Candidates (${candidates.length})`,
    '',
    candidateLines(candidates),
  ]
    .filter(Boolean)
    .join('\n')

  const result = await callJson({
    system: CURATOR_TASTE,
    prompt: brief,
    schema: PLAYLIST_SCHEMA,
    // The taste work. Worth the extra deliberation.
    effort: 'medium',
  })

  if (!result.ok) return result

  const curated = normaliseCurated(result.data)
  const byRef = new Map(candidates.map((c) => [c.ref, c]))

  const perArtist = new Map<string, number>()
  const perAlbum = new Map<string, number>()
  const seen = new Set<string>()
  const entries: PlaylistEntry[] = []

  for (const pick of curated.tracks) {
    const candidate = byRef.get(pick.ref)
    // A ref we did not offer, or the same track twice.
    if (!candidate || seen.has(pick.ref)) continue

    const artistUsed = perArtist.get(candidate.artistId) ?? 0
    const albumUsed = perAlbum.get(candidate.albumId) ?? 0
    if (artistUsed >= plan.constraints.max_per_artist) continue
    if (albumUsed >= plan.constraints.max_per_album) continue

    perArtist.set(candidate.artistId, artistUsed + 1)
    perAlbum.set(candidate.albumId, albumUsed + 1)
    seen.add(pick.ref)

    entries.push({
      ref: candidate.ref,
      track: candidate.track,
      artist: candidate.artist,
      album: candidate.album,
      albumId: candidate.albumId,
      imageUrl: candidate.imageUrl,
      reason: pick.reason,
    })
  }

  if (entries.length === 0) return { ok: false, failure: 'empty' }

  return {
    ok: true,
    playlist: {
      title: curated.title || plan.title_hint,
      linerNote: curated.liner_note,
      entries,
    },
  }
}
