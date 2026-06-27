import { useCallback, useState } from 'react'
import { fetchRecentPlays, healthCheck } from './pb'
import type { ConnectionState, RecentPlay } from './types'

const KEY = 'nostalge:recent:v1'

function load(): RecentPlay[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as RecentPlay[]) : []
  } catch {
    return []
  }
}

function save(plays: RecentPlay[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(plays))
  } catch {
    // ignore quota / private mode
  }
}

interface RecentState {
  plays: RecentPlay[]
  connection: ConnectionState
  syncing: boolean
  /** when we last successfully pulled live data (epoch ms), or 0 */
  checkedAt: number
  refresh: () => void
}

/**
 * Recent scrobbles for the sync-check tab. Mirrors the main data layer's
 * offline-graceful behaviour with its own little cache: show what we have,
 * probe PocketBase, replace on a successful live fetch, stay quiet otherwise.
 */
export function useRecentPlays(): RecentState {
  const [plays, setPlays] = useState<RecentPlay[]>(() => load())
  const [connection, setConnection] = useState<ConnectionState>(() =>
    load().length > 0 ? 'cached' : 'empty',
  )
  const [syncing, setSyncing] = useState(false)
  const [checkedAt, setCheckedAt] = useState(0)

  const sync = useCallback(async () => {
    setSyncing(true)
    try {
      const live = await healthCheck()
      if (!live) return
      const fresh = await fetchRecentPlays(100)
      if (fresh.length === 0) return
      save(fresh)
      setPlays(fresh)
      setConnection('live')
      setCheckedAt(Date.now())
    } catch {
      // stay on cache
    } finally {
      setSyncing(false)
    }
  }, [])

  // No auto-fetch: the user pulls fresh data with the refresh button. This
  // keeps reloads/visits from firing a health-check when away from the NAS.
  return { plays, connection, syncing, checkedAt, refresh: () => void sync() }
}
