import type { RecordModel } from 'pocketbase'

export interface Artist extends RecordModel {
  name: string
  mbid: string
  lastfm_url: string
  image_url: string
  bio: string
  tags: string[]
  similar_artists: string[]
  play_count: number
  listener_count: number
}

export interface Album extends RecordModel {
  title: string
  artist: string
  mbid: string
  lastfm_url: string
  image_url: string
  tags: string[]
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
