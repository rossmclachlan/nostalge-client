/**
 * Shapes for the natural-language playlist builder.
 *
 * The flow is three stages with a deterministic middle:
 *
 *   prompt -> [Claude] PlaylistPlan -> [our code] Candidate[] -> [Claude] Playlist
 *
 * Claude never names a track from memory: stage one emits a *query*, we run it
 * against the cached library, and stage three may only pick from the rows we
 * produced. Every track in a playlist provably exists in the collection.
 */

/* ------------------------------------------------------------------ */
/*  Stage 1 — the plan                                                 */
/* ------------------------------------------------------------------ */

/** How recently a record must (or must not) have been played. */
export interface LastPlayedFilter {
  /**
   * `any`             — no recency constraint
   * `never`           — no play in the cached window at all
   * `not_within_days` — nothing played in the last N days (the "forgotten" case)
   * `within_days`     — only records played in the last N days
   */
  mode: 'any' | 'never' | 'not_within_days' | 'within_days'
  days: number
}

export type PlayCountBand = 'any' | 'low' | 'medium' | 'high'

/** Rough listening slot, matched against the hour of cached plays. */
export type TimeOfDay = 'any' | 'morning' | 'afternoon' | 'evening' | 'late_night'

export type Arc = 'slow_build' | 'front_loaded' | 'even' | 'wind_down'

export interface PlaylistPlan {
  /** A working title. The curator may replace it. */
  title_hint: string
  /** One line on what this playlist is for — carried into stage 3. */
  intent: string
  length: { tracks: number }
  filters: {
    include_tags: string[]
    exclude_tags: string[]
    include_artists: string[]
    exclude_artists: string[]
    /** Release years, from Last.fm year tags. 0 = unset. */
    year_from: number
    year_to: number
    play_count_band: PlayCountBand
    last_played: LastPlayedFilter
    time_of_day: TimeOfDay
  }
  /** 0..1 — how hard to lean on each axis when scoring. */
  weights: {
    /** Favour records that have been sitting on the shelf. */
    neglect: number
    /** Favour low-play tracks on well-played albums. */
    deep_cut: number
  }
  constraints: {
    max_per_artist: number
    max_per_album: number
  }
  sequencing: {
    arc: Arc
    opener_note: string
    closer_note: string
  }
}

/* ------------------------------------------------------------------ */
/*  Stage 2 — candidates                                               */
/* ------------------------------------------------------------------ */

/**
 * One real track from the cached library, offered to the curator.
 *
 * `ref` is the stable identity: cached tracks carry no record id, so we key on
 * `albumId|title`. See `trackRef()` in execute.ts.
 */
export interface Candidate {
  ref: string
  albumId: string
  artistId: string
  track: string
  artist: string
  album: string
  imageUrl?: string
  /** Personal play count for this track. */
  plays: number
  /** Days since the album was last played; null when never played. */
  lastPlayedDays: number | null
  tags: string[]
  /** Internal ordering score — not sent to the model. */
  score: number
}

/* ------------------------------------------------------------------ */
/*  Stage 3 — the playlist                                             */
/* ------------------------------------------------------------------ */

export interface PlaylistEntry {
  ref: string
  track: string
  artist: string
  album: string
  albumId: string
  imageUrl?: string
  /** One concrete line on why this track, here. */
  reason: string
}

export interface Playlist {
  id: string
  /** The sentence the user typed. */
  prompt: string
  title: string
  /** A short paragraph in the voice of someone who knows the collection. */
  linerNote: string
  entries: PlaylistEntry[]
  /** The plan that produced it — kept so the run stays inspectable. */
  plan: PlaylistPlan
  /** epoch ms */
  createdAt: number
}

/* ------------------------------------------------------------------ */
/*  Run state                                                          */
/* ------------------------------------------------------------------ */

export type RunStage = 'idle' | 'planning' | 'digging' | 'sequencing' | 'done' | 'failed'

/** Why a run stopped. Never surfaced as a thrown error. */
export type RunFailure = 'no_key' | 'no_data' | 'offline' | 'refused' | 'empty' | 'unknown'
