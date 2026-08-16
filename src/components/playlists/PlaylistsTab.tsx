import { useEffect, useState } from 'react'
import { hasKey } from '@/lib/playlist/gemini'
import { usePlaylistRun } from '@/lib/playlist/run'
import type { MusicData } from '@/lib/types'
import { relativeAge } from '@/lib/format'
import { Cover } from '../Cover'
import { EmptyState, SectionHeader } from '../ui'
import { KeyGate } from './KeyGate'
import { RunPanel } from './RunPanel'

const EXAMPLES = [
  'a rainy Sunday morning',
  'late night, low light',
  'records I loved years ago and forgot',
  'something loud',
]

/**
 * Describe a playlist in a sentence; get one built out of your own crates.
 *
 * The prompt box is the whole interface. Saved playlists sit underneath and
 * open offline — only building one needs the network.
 */
export function PlaylistsTab({
  data,
  onOpenPlaylist,
}: {
  data: MusicData
  onOpenPlaylist: (id: string) => void
}) {
  const run = usePlaylistRun(data)
  const [prompt, setPrompt] = useState('')
  const [keySet, setKeySet] = useState(() => hasKey())

  // A finished run goes straight to its detail page.
  const done = run.stage === 'done' ? run.playlist : null
  const { reset } = run
  useEffect(() => {
    if (!done) return
    onOpenPlaylist(done.id)
    reset()
    setPrompt('')
  }, [done, onOpenPlaylist, reset])

  const busy =
    run.stage === 'planning' || run.stage === 'digging' || run.stage === 'sequencing'

  // First run with no key: lead with the setup card rather than a dead prompt box.
  if (!keySet && run.saved.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <SectionHeader kicker="Playlists" title="Ask for a set" />
        <p className="text-sm text-ink-2">
          Describe a mood, a moment, or a corner of the collection, and get a
          tracklist pulled from records you already own.
        </p>
        <KeyGate onSaved={() => setKeySet(hasKey())} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <SectionHeader kicker="Playlists" title="Ask for a set" />

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run.build(prompt)
        }}
        rows={3}
        disabled={busy}
        placeholder="Something for a slow Sunday, nothing I've played this year…"
        className="w-full resize-none border-[1.5px] border-ink bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none disabled:opacity-60"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => run.build(prompt)}
          disabled={busy || prompt.trim() === ''}
          className="btn-press bg-riso-red px-3 py-1.5 text-sm text-paper disabled:opacity-40"
        >
          {busy ? 'Digging…' : 'Build it'}
        </button>
        {!busy &&
          EXAMPLES.map((e) => (
            <button
              key={e}
              onClick={() => setPrompt(e)}
              className="label btn-press border-[1.5px] border-ink bg-paper px-2 py-[3px] leading-none !shadow-[1.5px_1.5px_0_0_var(--shadow-ink)]"
            >
              {e}
            </button>
          ))}
      </div>

      <RunPanel run={run} onKeyChange={() => setKeySet(hasKey())} />

      {run.saved.length > 0 ? (
        <div className="mt-10">
          <p className="label text-ink-3 mb-3">On the shelf</p>
          <ul className="space-y-3">
            {run.saved.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => onOpenPlaylist(p.id)}
                  className="flyer card-in flex w-full items-center gap-3 p-3 text-left"
                >
                  <div className="w-14 shrink-0">
                    <Cover
                      name={p.entries[0]?.album ?? p.title}
                      src={p.entries[0]?.imageUrl}
                      className="sleeve-blend"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="stamp-title text-[1.35rem] leading-[0.95]">{p.title}</p>
                    <p className="truncate text-xs text-ink-2">“{p.prompt}”</p>
                    <p className="label text-ink-3 mt-1">
                      {p.entries.length} tracks · {relativeAge(new Date(p.createdAt).toISOString())}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        run.stage === 'idle' && (
          <EmptyState
            title="Nothing made yet"
            body="Type a mood above. The set gets pulled from your own crates — never anything you don't own."
          />
        )
      )}
    </div>
  )
}
