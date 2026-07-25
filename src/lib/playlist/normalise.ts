import type { Arc, PlayCountBand, PlaylistPlan, TimeOfDay } from './types'

/**
 * Coerce model output into shapes the rest of the code can trust.
 *
 * Structured outputs already guarantee the schema, so this is not validation so
 * much as the last line of the app's "never an error state" rule: a surprising
 * value clamps to something sensible instead of throwing halfway through a run.
 */

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const asString = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v.trim() : fallback

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []

function asInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? Math.round(v) : Number.NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

function asUnit(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number.NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, 0), 1)
}

function asEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

const BANDS = ['any', 'low', 'medium', 'high'] as const satisfies readonly PlayCountBand[]
const TIMES = [
  'any',
  'morning',
  'afternoon',
  'evening',
  'late_night',
] as const satisfies readonly TimeOfDay[]
const ARCS = ['slow_build', 'front_loaded', 'even', 'wind_down'] as const satisfies readonly Arc[]
const MODES = ['any', 'never', 'not_within_days', 'within_days'] as const

export function normalisePlan(raw: unknown): PlaylistPlan {
  const r = asRecord(raw)
  const filters = asRecord(r.filters)
  const lastPlayed = asRecord(filters.last_played)
  const weights = asRecord(r.weights)
  const constraints = asRecord(r.constraints)
  const sequencing = asRecord(r.sequencing)
  const length = asRecord(r.length)

  return {
    title_hint: asString(r.title_hint, 'A set'),
    intent: asString(r.intent),
    length: { tracks: asInt(length.tracks, 16, 4, 40) },
    filters: {
      include_tags: asStrings(filters.include_tags),
      exclude_tags: asStrings(filters.exclude_tags),
      include_artists: asStrings(filters.include_artists),
      exclude_artists: asStrings(filters.exclude_artists),
      year_from: asInt(filters.year_from, 0, 0, 2100),
      year_to: asInt(filters.year_to, 0, 0, 2100),
      play_count_band: asEnum(filters.play_count_band, BANDS, 'any'),
      last_played: {
        mode: asEnum(lastPlayed.mode, MODES, 'any'),
        days: asInt(lastPlayed.days, 0, 0, 3650),
      },
      time_of_day: asEnum(filters.time_of_day, TIMES, 'any'),
    },
    weights: {
      neglect: asUnit(weights.neglect, 0.5),
      deep_cut: asUnit(weights.deep_cut, 0.3),
    },
    constraints: {
      max_per_artist: asInt(constraints.max_per_artist, 2, 1, 10),
      max_per_album: asInt(constraints.max_per_album, 1, 1, 10),
    },
    sequencing: {
      arc: asEnum(sequencing.arc, ARCS, 'even'),
      opener_note: asString(sequencing.opener_note),
      closer_note: asString(sequencing.closer_note),
    },
  }
}

export interface CuratedTrack {
  ref: string
  reason: string
}

export interface Curated {
  title: string
  liner_note: string
  tracks: CuratedTrack[]
}

export function normaliseCurated(raw: unknown): Curated {
  const r = asRecord(raw)
  const tracks = Array.isArray(r.tracks) ? r.tracks : []
  return {
    title: asString(r.title),
    liner_note: asString(r.liner_note),
    tracks: tracks
      .map((t) => {
        const row = asRecord(t)
        return { ref: asString(row.ref), reason: asString(row.reason) }
      })
      .filter((t) => t.ref !== ''),
  }
}
