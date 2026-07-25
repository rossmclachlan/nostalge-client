import type { MusicData } from '../types'

/**
 * A compact portrait of the collection, for the planner.
 *
 * The library is far too big to send (thousands of albums, tens of thousands of
 * tracks) and the planner does not need it — it only has to know what vocabulary
 * this collection uses so it can aim a query. Tags, top artists, the shape of the
 * play history.
 *
 * Pure, and stable between syncs: it is the cached prefix of every request in a
 * session, so it must not contain a clock or anything else that varies per run.
 */

const TAG_LIMIT = 150
const ARTIST_LIMIT = 100
const YEAR_TAG = /^(19|20)\d{2}$/

export function buildDigest(data: MusicData): string {
  const tags = [...data.tags]
    .filter((t) => t.name && !YEAR_TAG.test(t.name))
    .sort((a, b) => (b.usage_count ?? 0) - (a.usage_count ?? 0))
    .slice(0, TAG_LIMIT)
    .map((t) => `${t.name} (${t.usage_count ?? 0})`)

  const years = [...data.tags]
    .filter((t) => YEAR_TAG.test(t.name))
    .map((t) => Number(t.name))
    .sort((a, b) => a - b)

  const artists = [...data.artists]
    .sort((a, b) => (b.play_count ?? 0) - (a.play_count ?? 0))
    .slice(0, ARTIST_LIMIT)
    .map((a) => a.name)

  // The cached play window, so the planner knows what recency filters can reach.
  let oldest = Number.POSITIVE_INFINITY
  let newest = 0
  for (const p of data.plays) {
    const t = new Date(p.at).getTime()
    if (Number.isNaN(t)) continue
    if (t < oldest) oldest = t
    if (t > newest) newest = t
  }
  const windowDays =
    newest > 0 && Number.isFinite(oldest)
      ? Math.round((newest - oldest) / 86_400_000)
      : 0

  const lines = [
    '# The collection',
    '',
    `${data.artists.length} artists, ${data.albums.length} albums, ${data.tracks.length} tracks with play counts.`,
    `Play history covers roughly the last ${windowDays} days (${data.plays.length} plays).`,
  ]

  if (years.length > 0) {
    lines.push(
      `Release years available as tags, from ${years[0]} to ${years[years.length - 1]}.`,
    )
  }

  lines.push(
    '',
    '## Tags, most used first',
    'Use these names exactly when filtering by tag.',
    '',
    tags.join(', '),
    '',
    '## Most-played artists',
    'These are the well-worn ones — usually the records that need no reminding.',
    '',
    artists.join(', '),
  )

  return lines.join('\n')
}
