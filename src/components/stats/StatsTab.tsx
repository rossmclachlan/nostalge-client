import { useMemo } from 'react'
import type { MusicData } from '@/lib/types'
import { deriveStats } from '@/lib/derive'
import { formatPlays } from '@/lib/format'
import { EmptyState, SectionHeader } from '../ui'

export function StatsTab({
  data,
  onOpenArtist,
  onOpenAlbum,
}: {
  data: MusicData
  onOpenArtist: (id: string) => void
  onOpenAlbum: (id: string) => void
}) {
  const stats = useMemo(() => deriveStats(data), [data])

  if (stats.totalArtists === 0 && stats.totalAlbums === 0) {
    return (
      <EmptyState
        title="No numbers yet"
        body="Your listening stats appear here once the collection has synced at least once."
      />
    )
  }

  return (
    <div className="space-y-10">
      {/* Headline figures */}
      <section className="grid grid-cols-2 gap-3">
        <BigStat value={formatPlays(stats.totalPlays)} label="total plays" tone="red" />
        <BigStat value={String(stats.totalArtists)} label="artists" tone="olive" />
        <BigStat value={String(stats.totalAlbums)} label="albums" tone="ink" />
        <BigStat
          value={stats.busiestMonth ? String(stats.busiestMonth.count) : '—'}
          label={
            stats.busiestMonth
              ? `plays in ${stats.busiestMonth.label}`
              : 'busiest month'
          }
          tone="yellow"
        />
      </section>

      {/* Top artists */}
      {stats.topArtists.length > 0 && (
        <section>
          <SectionHeader kicker="all time" title="Top Artists" />
          <ol>
            {stats.topArtists.map((a, i) => (
              <li key={a.id}>
                <button
                  onClick={() => onOpenArtist(a.id)}
                  className="flex w-full items-baseline gap-3 border-b-[1.5px] border-ink/30 py-2 text-left active:bg-paper-3"
                >
                  <span className="font-display w-9 shrink-0 text-3xl leading-none text-riso-red">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-display text-2xl uppercase leading-none text-ink">
                    {a.name}
                  </span>
                  <span className="label text-ink-3 shrink-0">
                    {formatPlays(a.play_count)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Top albums */}
      {stats.topAlbums.length > 0 && (
        <section>
          <SectionHeader kicker="all time" title="Top Albums" />
          <ol>
            {stats.topAlbums.map((a, i) => (
              <li key={a.id}>
                <button
                  onClick={() => onOpenAlbum(a.id)}
                  className="flex w-full items-baseline gap-3 border-b-[1.5px] border-ink/30 py-2 text-left active:bg-paper-3"
                >
                  <span className="font-display w-9 shrink-0 text-3xl leading-none text-riso-olive">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-xl uppercase leading-none text-ink">
                      {a.title}
                    </span>
                    <span className="label text-ink-3 truncate">{a.artistName}</span>
                  </span>
                  <span className="label text-ink-3 shrink-0">
                    {formatPlays(a.play_count)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="label text-ink-3 pt-2 text-center">
        most-active month from {formatPlays(stats.windowPlays)} recent scrobbles
      </p>
    </div>
  )
}

function BigStat({
  value,
  label,
  tone,
}: {
  value: string
  label: string
  tone: 'red' | 'olive' | 'yellow' | 'ink'
}) {
  const tones = {
    red: 'bg-riso-red text-paper',
    olive: 'bg-riso-olive text-paper',
    yellow: 'bg-riso-yellow text-ink',
    ink: 'bg-ink text-paper',
  }
  return (
    <div className={`flyer aged ${tones[tone]} px-3 py-4`}>
      <p className="font-display text-5xl leading-none">{value}</p>
      <p className="label mt-2 opacity-80">{label}</p>
    </div>
  )
}
