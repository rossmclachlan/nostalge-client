import { useCallback, useMemo, useState } from 'react'
import { hasData } from '../cache'
import type { MusicData } from '../types'
import { hasKey } from './gemini'
import { curatePlaylist } from './curate'
import { buildDigest } from './digest'
import { executePlan } from './execute'
import { planPlaylist } from './plan'
import { deletePlaylist, loadPlaylists, newPlaylistId, savePlaylist } from './store'
import type { Playlist, PlaylistPlan, RunFailure, RunStage } from './types'

/**
 * Drives the three stages and keeps the shelf of saved playlists.
 *
 * Every stage reports failure as a value, never a throw — consistent with the
 * rest of the app, where the worst case is a quiet card rather than an error.
 */
export interface PlaylistRun {
  stage: RunStage
  plan: PlaylistPlan | null
  /** How many real tracks the dig turned up. */
  found: number
  playlist: Playlist | null
  failure: RunFailure | null
  /** The API's own words, when there are any. */
  failureDetail: string | null
  saved: Playlist[]
  build: (prompt: string) => void
  reset: () => void
  remove: (id: string) => void
}

export function usePlaylistRun(data: MusicData): PlaylistRun {
  const [stage, setStage] = useState<RunStage>('idle')
  const [plan, setPlan] = useState<PlaylistPlan | null>(null)
  const [found, setFound] = useState(0)
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [failure, setFailure] = useState<RunFailure | null>(null)
  const [failureDetail, setFailureDetail] = useState<string | null>(null)
  const [saved, setSaved] = useState<Playlist[]>(() => loadPlaylists())

  // Stable between syncs, so it stays the cached prefix across runs.
  const digest = useMemo(() => buildDigest(data), [data])

  const build = useCallback(
    (prompt: string) => {
      const text = prompt.trim()
      if (text === '' || stage === 'planning' || stage === 'digging' || stage === 'sequencing') {
        return
      }

      const fail = (reason: RunFailure, detail?: string) => {
        setFailure(reason)
        setFailureDetail(detail ?? null)
        setStage('failed')
      }

      void (async () => {
        setPlan(null)
        setPlaylist(null)
        setFailure(null)
        setFailureDetail(null)
        setFound(0)

        if (!hasKey()) return fail('no_key')
        if (!hasData(data)) return fail('no_data')

        setStage('planning')
        const planned = await planPlaylist(text, digest)
        if (!planned.ok) return fail(planned.failure, planned.detail)
        setPlan(planned.plan)

        setStage('digging')
        const candidates = executePlan(planned.plan, data, Date.now(), Math.floor(Math.random() * 0x7fffffff))
        setFound(candidates.length)
        if (candidates.length === 0) return fail('empty')

        setStage('sequencing')
        const curated = await curatePlaylist(text, planned.plan, candidates)
        if (!curated.ok) return fail(curated.failure, curated.detail)

        const result: Playlist = {
          id: newPlaylistId(),
          prompt: text,
          title: curated.playlist.title,
          linerNote: curated.playlist.linerNote,
          entries: curated.playlist.entries,
          plan: planned.plan,
          createdAt: Date.now(),
        }

        setPlaylist(result)
        setSaved(savePlaylist(result))
        setStage('done')
      })()
    },
    [data, digest, stage],
  )

  const reset = useCallback(() => {
    setStage('idle')
    setPlan(null)
    setPlaylist(null)
    setFailure(null)
    setFailureDetail(null)
    setFound(0)
  }, [])

  const remove = useCallback((id: string) => {
    setSaved(deletePlaylist(id))
  }, [])

  return { stage, plan, found, playlist, failure, failureDetail, saved, build, reset, remove }
}
