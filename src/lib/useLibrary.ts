import { useCallback, useEffect, useRef, useState } from 'react'
import { hasData, loadCache, saveCache } from './cache'
import {
  ensureSession,
  fetchAlbums,
  fetchArtists,
  fetchPlays,
  fetchTags,
  fetchTracks,
  healthCheck,
} from './pb'
import type { ConnectionState, MusicData } from './types'
import { useAuth } from './useAuth'

interface LibraryState {
  data: MusicData
  connection: ConnectionState
  syncing: boolean
  /** The server answered but there's no usable session: ask for a sign-in. */
  needsSignIn: boolean
  refresh: () => void
}

/**
 * The offline-graceful data layer, as a hook.
 *
 *  - On load it surfaces whatever is cached (instant, works offline). It does
 *    NOT sync automatically — syncing only happens when `refresh()` is called
 *    (the masthead refresh button), so reloading while away from the home
 *    network doesn't kick off a doomed health-check every time.
 *  - `refresh()` probes PocketBase; if it answers, fresh data replaces the
 *    cache, otherwise the cache stays put.
 *  - The reads need a signed-in user. If the server answers but there's no
 *    usable session, `needsSignIn` goes true and the cache stays put. Being
 *    away from home never asks for a sign-in, since it couldn't succeed.
 *  - Signing in, from any sign-in card (including the Recent tab's), syncs
 *    the library straight away. Otherwise signing in on the Recent tab only
 *    pulled recent plays and every other tab stayed on "no signal".
 *
 * There is no error state by design: worst case we show an empty/welcome
 * screen.
 */
export function useLibrary(): LibraryState {
  const [data, setData] = useState<MusicData>(() => loadCache())
  const [connection, setConnection] = useState<ConnectionState>(() =>
    hasData(loadCache()) ? 'cached' : 'empty',
  )
  const [syncing, setSyncing] = useState(false)
  const [sessionRejected, setSessionRejected] = useState(false)
  const email = useAuth()

  const inFlight = useRef(false)

  const sync = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setSyncing(true)
    try {
      const live = await healthCheck()
      if (!live) return // keep cached/empty state

      const session = await ensureSession()
      setSessionRejected(session === 'signed-out')
      if (session !== 'ok') return

      const [artists, albums, tags, plays, tracks] = await Promise.all([
        fetchArtists(),
        fetchAlbums(),
        fetchTags(),
        fetchPlays(),
        fetchTracks(),
      ])

      // Only commit a fresh fetch if it actually returned something — a
      // health-check pass followed by empty reads shouldn't wipe the cache.
      if (artists.length === 0 && albums.length === 0) return

      const fresh: MusicData = {
        artists,
        albums,
        tags,
        plays,
        tracks,
        fetchedAt: Date.now(),
      }
      saveCache(fresh)
      setData(fresh)
      setConnection('live')
    } catch {
      // Silent — stay on whatever we already had.
    } finally {
      inFlight.current = false
      setSyncing(false)
    }
  }, [])

  // A sign-in is the user asking for data, wherever it happened.
  const prevEmail = useRef(email)
  useEffect(() => {
    if (email !== '' && prevEmail.current === '') void sync()
    prevEmail.current = email
  }, [email, sync])

  const refresh = useCallback(() => {
    void sync()
  }, [sync])

  // Signing in (from anywhere) clears the prompt without waiting for a sync.
  const needsSignIn = sessionRejected && email === ''

  return { data, connection, syncing, needsSignIn, refresh }
}
