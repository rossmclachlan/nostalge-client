import { useMemo } from 'react'
import { useRecentPlays } from '@/lib/useRecentPlays'
import type { MusicData, RecentPlay } from '@/lib/types'
import { clockTime, dayHeading, relativeAge } from '@/lib/format'
import { EmptyState } from '../ui'
import { RefreshIcon } from '../icons'
import { CoverTile } from '../CoverTile'
import { SignedInAs, SignInGate } from '../SignIn'
import { cn } from '@/lib/cn'

/** One record spun in a sitting: consecutive plays of the same album fold into it. */
interface Spin {
  key: string
  title: string
  artist: string
  /** time of the most recent play in the run */
  at: string
  albumId?: string
  imageUrl?: string
}

export function RecentTab({
  data,
  onOpenAlbum,
}: {
  data: MusicData
  onOpenAlbum: (id: string) => void
}) {
  const { plays, connection, syncing, needsSignIn, refresh } = useRecentPlays()

  // Scrobbles only carry names, so find each record's sleeve by artist + album.
  const albumByName = useMemo(() => {
    const artistName = new Map(data.artists.map((a) => [a.id, a.name.toLowerCase()]))
    const map = new Map<string, { id: string; image_url: string }>()
    for (const al of data.albums) {
      map.set(`${artistName.get(al.artist) ?? ''}|${al.title.toLowerCase()}`, al)
    }
    return map
  }, [data])

  // Day headings, then the records spun that day (plays are newest-first).
  const days = useMemo(() => {
    const out: { day: string; spins: Spin[] }[] = []
    let prev: RecentPlay | undefined
    for (const p of plays) {
      const day = dayHeading(p.at)
      let group = out[out.length - 1]
      if (!group || group.day !== day) {
        group = { day, spins: [] }
        out.push(group)
        prev = undefined
      }
      const sameRecord =
        prev && p.album && prev.album === p.album && prev.artist === p.artist
      if (!sameRecord) {
        const hit = albumByName.get(`${p.artist.toLowerCase()}|${p.album.toLowerCase()}`)
        group.spins.push({
          key: p.id,
          title: p.album || p.track,
          artist: p.artist,
          at: p.at,
          albumId: hit?.id,
          imageUrl: hit?.image_url,
        })
      }
      prev = p
    }
    return out
  }, [plays, albumByName])

  const newest = plays[0]?.at

  return (
    <div>
      {/* Sync status: still here, just smaller than the art. */}
      <div className="mb-5 flex items-center gap-3 rounded-2xl bg-paper-3 py-2 pl-4 pr-1.5">
        <SyncDot connection={connection} syncing={syncing} />
        <p className="min-w-0 flex-1 text-[0.8rem] leading-snug text-ink-2">
          {syncing
            ? 'Checking the NAS…'
            : newest
              ? `Last scrobble ${relativeAge(newest)}, ${clockTime(newest)}`
              : 'No scrobbles yet'}
          {!syncing && needsSignIn && ' · sign in to pull fresh plays'}
          {!syncing && !needsSignIn && connection === 'cached' && ' · saved copy'}
        </p>
        <button
          onClick={refresh}
          disabled={syncing}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink active:bg-paper disabled:opacity-50"
          aria-label="Check sync now"
        >
          <RefreshIcon className={cn('h-[18px] w-[18px]', syncing && 'animate-spin')} />
        </button>
      </div>
      <SignedInAs />

      {needsSignIn && <SignInGate onSignedIn={refresh} />}

      {plays.length === 0 ? (
        <EmptyState
          title="Quiet on the wire"
          body="No recent scrobbles to show. If the NAS sync is running, they'll appear here the next time the server is reachable."
        />
      ) : (
        <div className="mt-2 space-y-7">
          {days.map(({ day, spins }, i) => (
            <section key={day}>
              <div className="mb-2.5 flex items-center gap-2">
                <h2 className="text-[1.35rem]">{day}</h2>
                {i === 0 && (
                  <span className="price-sticker text-[0.7rem]">
                    {spins.length} {spins.length === 1 ? 'record' : 'records'}
                  </span>
                )}
              </div>
              {/* The latest day gets big sleeves; earlier days pack tighter. */}
              <div
                className={cn(
                  'grid',
                  i === 0
                    ? 'grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-4'
                    : 'grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-6 lg:grid-cols-8',
                )}
              >
                {spins.map((s) => (
                  <CoverTile
                    key={s.key}
                    title={s.title}
                    subtitle={s.artist}
                    src={s.imageUrl}
                    onClick={() => s.albumId && onOpenAlbum(s.albumId)}
                    badge={
                      i === 0 ? (
                        <span className="absolute bottom-1.5 right-1.5 rounded-full bg-ink px-2 py-0.5 text-[0.68rem] font-bold text-paper-2">
                          {clockTime(s.at)}
                        </span>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function SyncDot({
  connection,
  syncing,
}: {
  connection: 'live' | 'cached' | 'empty'
  syncing: boolean
}) {
  const cls = syncing
    ? 'bg-paper-2 animate-pulse'
    : { live: 'bg-riso-olive', cached: 'bg-sun', empty: 'bg-ink-3' }[connection]
  const label = syncing ? 'syncing' : { live: 'live', cached: 'cached', empty: 'no signal' }[connection]
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn('h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-ink', cls)}
    />
  )
}
