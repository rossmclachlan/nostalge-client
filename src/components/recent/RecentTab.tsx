import { useMemo } from 'react'
import { useRecentPlays } from '@/lib/useRecentPlays'
import type { RecentPlay } from '@/lib/types'
import { clockTime, dayHeading, relativeAge } from '@/lib/format'
import { EmptyState } from '../ui'
import { ClockIcon, RefreshIcon } from '../icons'
import { cn } from '@/lib/cn'

export function RecentTab() {
  const { plays, connection, syncing, refresh } = useRecentPlays()

  // Group consecutive plays under day headings (already newest-first).
  const groups = useMemo(() => {
    const out: { day: string; items: RecentPlay[] }[] = []
    for (const p of plays) {
      const day = dayHeading(p.at)
      const last = out[out.length - 1]
      if (last && last.day === day) last.items.push(p)
      else out.push({ day, items: [p] })
    }
    return out
  }, [plays])

  const newest = plays[0]?.at

  return (
    <div>
      {/* Sync status panel — the whole point of this tab */}
      <div className="flyer aged mb-6 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="label text-riso-red mb-1">last scrobble</p>
            <p className="font-display text-3xl leading-none text-ink">
              {newest ? relativeAge(newest) : '—'}
            </p>
            {newest && (
              <p className="label text-ink-3 mt-1.5">
                {dayHeading(newest)} · {clockTime(newest)}
              </p>
            )}
          </div>
          <button
            onClick={refresh}
            disabled={syncing}
            className="btn-press grid h-10 w-10 shrink-0 place-items-center disabled:opacity-50"
            aria-label="Check sync now"
          >
            <RefreshIcon className={cn('h-4 w-4', syncing && 'animate-spin')} />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <SyncFlag connection={connection} syncing={syncing} />
          <p className="label text-ink-3">
            {syncing
              ? 'checking the NAS…'
              : connection === 'live'
                ? 'pulled fresh from the server'
                : connection === 'cached'
                  ? 'showing last-known (server unreachable)'
                  : 'no scrobbles yet'}
          </p>
        </div>
      </div>

      {plays.length === 0 ? (
        <EmptyState
          title="Quiet on the wire"
          body="No recent scrobbles to show. If the NAS sync is running, they'll appear here the next time the server is reachable."
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.day}>
              <div className="mb-2 flex items-center gap-2">
                <ClockIcon className="h-3.5 w-3.5 text-ink-3" />
                <h2 className="label text-ink-2">{group.day}</h2>
                <span className="h-px flex-1 bg-ink/20" />
              </div>
              <ul className="border-y-[1.5px] border-ink divide-y divide-ink/15">
                {group.items.map((p) => (
                  <li key={p.id} className="flex items-baseline gap-3 py-2">
                    <span className="label text-ink-3 w-11 shrink-0 tabular-nums">
                      {clockTime(p.at)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {p.track}
                      </span>
                      <span className="block truncate text-xs text-ink-3">
                        {p.artist}
                        {p.album ? ` · ${p.album}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function SyncFlag({
  connection,
  syncing,
}: {
  connection: 'live' | 'cached' | 'empty'
  syncing: boolean
}) {
  if (syncing) return <span className="label text-ink-3">syncing…</span>
  const map = {
    live: { text: 'live', cls: 'bg-riso-olive text-paper' },
    cached: { text: 'cached', cls: 'bg-riso-yellow text-ink' },
    empty: { text: 'no signal', cls: 'bg-ink text-paper' },
  } as const
  const f = map[connection]
  return (
    <span className={cn('label border-[1.5px] border-ink px-1.5 py-[2px] leading-none', f.cls)}>
      {f.text}
    </span>
  )
}
