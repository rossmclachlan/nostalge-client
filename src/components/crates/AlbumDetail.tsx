import { useEffect, useMemo, useState } from 'react'
import type { MusicData, Tag, Track } from '@/lib/types'
import { lastPlayedForAlbum } from '@/lib/derive'
import { fetchTracksForAlbum } from '@/lib/pb'
import { formatPlays, plainText, relativeAge } from '@/lib/format'
import { Cover } from '../Cover'
import { Chip, PlayBadge } from '../ui'
import { DetailHeader } from '../DetailHeader'

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function AlbumDetail({
  data,
  albumId,
  onBack,
  onOpenArtist,
  onOpenTag,
}: {
  data: MusicData
  albumId: string
  onBack: () => void
  onOpenArtist: (id: string) => void
  onOpenTag: (id: string) => void
}) {
  const album = data.albums.find((a) => a.id === albumId)
  const artist = data.artists.find((a) => a.id === album?.artist)
  const lastPlayed = useMemo(() => lastPlayedForAlbum(data, albumId), [data, albumId])
  const tags = useMemo(
    () => resolveTags(data, album?.tag_relations ?? []),
    [data, album],
  )

  const [tracks, setTracks] = useState<Track[]>([])
  const [loadingTracks, setLoadingTracks] = useState(true)

  useEffect(() => {
    let alive = true
    setLoadingTracks(true)
    // Tracklists aren't cached — fetch on demand, silently no-op offline.
    fetchTracksForAlbum(albumId).then((t) => {
      if (alive) {
        setTracks(t)
        setLoadingTracks(false)
      }
    })
    return () => {
      alive = false
    }
  }, [albumId])

  if (!album) {
    return (
      <div>
        <DetailHeader title="Not found" onBack={onBack} />
        <p className="label text-ink-3 p-6">This sleeve isn't in the crate.</p>
      </div>
    )
  }

  return (
    <div>
      <DetailHeader title="Album" onBack={onBack} />

      <div className="p-4">
        <div className="tilt-r mx-auto w-2/3 max-w-[16rem]">
          <Cover name={album.title} src={album.image_url} />
        </div>

        <div className="mt-5 text-center">
          <h1 className="stamp-title text-[2.2rem] break-words">{album.title}</h1>
          {artist && (
            <button
              onClick={() => onOpenArtist(artist.id)}
              className="label text-riso-red mt-1 underline-offset-2 active:underline"
            >
              {artist.name}
            </button>
          )}
        </div>

        {/* Two big facts */}
        <div className="mt-5 flex items-stretch justify-center gap-3">
          <div className="flyer aged flex-1 px-3 py-3 text-center">
            <p className="font-display text-4xl leading-none text-ink">
              {formatPlays(album.play_count)}
            </p>
            <p className="label text-ink-3 mt-1">total plays</p>
          </div>
          <div className="flyer aged flex-1 px-3 py-3 text-center">
            <p className="font-display text-2xl leading-none text-ink">
              {lastPlayed
                ? relativeAge(new Date(lastPlayed).toISOString())
                : 'a while'}
            </p>
            <p className="label text-ink-3 mt-1">last spun</p>
          </div>
        </div>

        {tags.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {tags.slice(0, 6).map((t) => (
              <Chip key={t.id} tone="olive" onClick={() => onOpenTag(t.id)}>
                {t.name}
              </Chip>
            ))}
          </div>
        )}

        {album.wiki_summary && (
          <p className="mt-5 border-l-[3px] border-riso-red pl-3 text-sm leading-relaxed text-ink-2">
            {plainText(album.wiki_summary, 320)}
          </p>
        )}

        {/* Tracklist */}
        <h2 className="stamp-title mt-8 mb-3 text-[1.6rem]">Tracklist</h2>
        {loadingTracks ? (
          <p className="label text-ink-3">reading the back cover…</p>
        ) : tracks.length === 0 ? (
          <p className="label text-ink-3">
            No tracklist on hand{' '}
            <span className="normal-case tracking-normal">
              (it lives on the home server)
            </span>
            .
          </p>
        ) : (
          <ol className="divide-y divide-ink/20 border-y-[1.5px] border-ink">
            {tracks.map((track, i) => (
              <li key={track.id} className="flex items-center gap-3 py-2">
                <span className="font-display w-6 text-lg text-ink-3">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {track.title}
                </span>
                {track.play_count > 0 && (
                  <span className="label text-ink-3">{formatPlays(track.play_count)}</span>
                )}
                {track.duration > 0 && (
                  <span className="label text-ink-3 w-10 text-right tabular-nums">
                    {formatDuration(track.duration)}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}

        {album.play_count > 0 && (
          <div className="mt-6 flex justify-center">
            <PlayBadge count={album.play_count} />
          </div>
        )}
      </div>
    </div>
  )
}

function resolveTags(data: MusicData, ids: string[]): Tag[] {
  if (!ids?.length) return []
  const byId = new Map(data.tags.map((t) => [t.id, t]))
  return ids.map((id) => byId.get(id)).filter((t): t is Tag => Boolean(t))
}
