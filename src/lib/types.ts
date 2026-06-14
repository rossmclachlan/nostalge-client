import type { RecordModel } from 'pocketbase'

/* ------------------------------------------------------------------ */
/*  PocketBase collection shapes                                       */
/* ------------------------------------------------------------------ */

export interface Artist extends RecordModel {
  name: string
  mbid: string
  lastfm_url: string
  image_url: string
  bio: string
  tags: string[]
  tag_relations: string[]
  similar_artists: string[]
  play_count: number
  listener_count: number
}

export interface Album extends RecordModel {
  title: string
  artist: string // artist record id
  mbid: string
  lastfm_url: string
  image_url: string
  tags: string[]
  tag_relations: string[]
  wiki_summary: string
  play_count: number
  track_count: number
}

export interface Track extends RecordModel {
  title: string
  artist: string
  album: string
  mbid: string
  lastfm_url: string
  duration: number
  play_count: number
}

export interface Scrobble extends RecordModel {
  track: string
  scrobbled_at: string
}

export interface Tag extends RecordModel {
  name: string
  usage_count: number
}

/* ------------------------------------------------------------------ */
/*  Local cache shapes                                                 */
/* ------------------------------------------------------------------ */

/** A slimmed scrobble we keep locally for deriving stats / recency. */
export interface PlayEvent {
  /** artist record id */
  ar: string
  /** album record id (may be empty) */
  al: string
  /** ISO timestamp the track was scrobbled */
  at: string
}

/** A recent scrobble with display details, for the Recent tab / sync check. */
export interface RecentPlay {
  id: string
  track: string
  artist: string
  album: string
  /** ISO timestamp the track was scrobbled */
  at: string
}

export interface MusicData {
  artists: Artist[]
  albums: Album[]
  tags: Tag[]
  plays: PlayEvent[]
  /** epoch ms of the last successful fetch */
  fetchedAt: number
}

export type ConnectionState = 'live' | 'cached' | 'empty'
