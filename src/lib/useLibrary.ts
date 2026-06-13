import { useCallback, useEffect, useState } from 'react'
import { hasData, loadCache, saveCache } from './cache'
import { fetchAlbums, fetchArtists, fetchPlays, fetchTags, healthCheck } from './pb'
import type { ConnectionState, MusicData } from './types'

interface LibraryState {
  data: MusicData
  connection: ConnectionState
  syncing: boolean
  refresh: () => void
}

/**
 * The offline-graceful data layer, as a hook.
 *
 *  1. Immediately surface whatever is cached (instant, works offline).
 *  2. Probe PocketBase. If it answers, fetch fresh data and replace the
 *     cache. If it doesn't, do nothing — we keep showing the cache.
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

  const sync = useCallback(async () => {
    setSyncing(true)
    try {
      const live = await healthCheck()
      if (!live) return // keep cached/empty state

      const [artists, albums, tags, plays] = await Promise.all([
        fetchArtists(),
        fetchAlbums(),
        fetchTags(),
        fetchPlays(),
      ])

      // Only commit a fresh fetch if it actually returned something — a
      // health-check pass followed by empty reads shouldn't wipe the cache.
      if (artists.length === 0 && albums.length === 0) return

      const fresh: MusicData = {
        artists,
        albums,
        tags,
        plays,
        fetchedAt: Date.now(),
      }
      saveCache(fresh)
      setData(fresh)
      setConnection('live')
    } catch {
      // Silent — stay on whatever we already had.
    } finally {
      setSyncing(false)
    }
  }, [])

  useEffect(() => {
    void sync()
  }, [sync])

  const refresh = useCallback(() => {
    void sync()
  }, [sync])

  return { data, connection, syncing, refresh }
}
