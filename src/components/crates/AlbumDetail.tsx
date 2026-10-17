import { useEffect, useMemo, useState } from 'react'
import type { MusicData, Tag, Track } from '@/lib/types'
import { albumsForArtist, kindredAlbums, lastPlayedForAlbum } from '@/lib/derive'
import { fetchTracksForAlbum } from '@/lib/pb'
import { formatPlays, plainText, relativeAge } from '@/lib/format'
import { Cover } from '../Cover'
import { Chip } from '../ui'
import { CoverRow, CoverTile } from '../CoverTile'
import { Disclosure } from '../Disclosure'
import { CopyButton } from '../CopyButton'
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
  onOpenAlbum,
  onOpenTag,
}: {
  data: MusicData
  albumId: string
  onBack: () => void
  onOpenArtist: (id: string) => void
  onOpenAlbum: (id: string) => void
  onOpenTag: (id: string) => void
}) {
  const album = data.albums.find((a) => a.id === albumId)
  const artist = data.artists.find((a) => a.id === album?.artist)
  const lastPlayed = useMemo(() => lastPlayedForAlbum(data, albumId), [data, albumId])
  const tags = useMemo(
    () => resolveTags(data, album?.tag_relations ?? []),
    [data, album],
  )

  const moreByArtist = useMemo(
    () => (album ? albumsForArtist(data, album.artist).filter((a) => a.id !== albumId) : []),
    [data, album, albumId],
  )
  const kindred = useMemo(() => kindredAlbums(data, albumId), [data, albumId])

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
      <DetailHeader title="Record" onBack={onBack} />

      {/* The sleeve first, as big as the screen allows. */}
      <div className="px-4 pt-2">
        <div className="mx-auto w-[86%] max-w-sm">
          <Cover name={album.title} src={album.image_url} className="sleeve-lift rounded-[4px]" />
        </div>
      </div>

      <div className="mt-5 px-4">
        <h1 className="text-[1.9rem] break-words">{album.title}</h1>
        {artist && (
          <button
            onClick={() => onOpenArtist(artist.id)}
            className="mt-1 text-[1rem] font-semibold text-indigo underline-offset-2 active:underline"
          >
            {artist.name} ›
          </button>
        )}
        <div className="mt-3">
          <CopyButton
            text={artist ? `${artist.name} - ${album.title}` : album.title}
            label="Copy to search"
            className="sticker border-ink bg-sun px-3.5 py-1.5 text-[0.8rem]"
          />
        </div>
      </div>

      {tags.length > 0 && (
        <div className="no-scrollbar mt-4 flex gap-1.5 overflow-x-auto px-4">
          {tags.slice(0, 8).map((t) => (
            <Chip key={t.id} onClick={() => onOpenTag(t.id)} className="shrink-0">
              {t.name}
            </Chip>
          ))}
        </div>
      )}

      {moreByArtist.length > 0 && artist && (
        <CoverRow
          title={`More from ${artist.name}`}
          action={
            <button onClick={() => onOpenArtist(artist.id)} className="shrink-0 text-[0.85rem] font-semibold text-indigo">
              All
            </button>
          }
        >
          {moreByArtist.slice(0, 12).map((a) => (
            <CoverTile
              key={a.id}
              title={a.title}
              subtitle={a.track_count > 0 ? `${a.track_count} tracks` : undefined}
              src={a.image_url}
              onClick={() => onOpenAlbum(a.id)}
              className="w-[30%] max-w-[9rem] shrink-0 snap-start"
            />
          ))}
        </CoverRow>
      )}

      {kindred.length > 0 && (
        <CoverRow title="Kindred records">
          {kindred.map((a) => (
            <CoverTile
              key={a.id}
              title={a.title}
              subtitle={a.artistName}
              src={a.image_url}
              onClick={() => onOpenAlbum(a.id)}
              className="w-[30%] max-w-[9rem] shrink-0 snap-start"
            />
          ))}
        </CoverRow>
      )}

      <Disclosure title="Tracks, plays and notes">
        <div className="flex gap-3">
          <Fact value={formatPlays(album.play_count)} label="plays" />
          <Fact
            value={lastPlayed ? relativeAge(new Date(lastPlayed).toISOString()) : 'a while'}
            label="last spun"
          />
        </div>

        {album.wiki_summary && (
          <p className="mt-4 text-sm leading-relaxed text-ink-2">
            {plainText(album.wiki_summary, 320)}
          </p>
        )}

        <div className="mt-4">
          <CopyButton text={album.title} label="Copy album" />
        </div>

        <h3 className="mt-5 mb-2 text-[1.15rem]">Tracklist</h3>
        {loadingTracks ? (
          <p className="label text-ink-3">reading the back cover…</p>
        ) : tracks.length === 0 ? (
          <p className="label text-ink-3">No tracklist on hand (it lives on the home server).</p>
        ) : (
          <ol className="divide-y divide-kraft">
            {tracks.map((track, i) => (
              <li key={track.id} className="flex items-center gap-3 py-2">
                <span className="w-5 text-right text-sm text-ink-3 tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{track.title}</span>
                {track.play_count > 0 && (
                  <span className="label text-ink-3">{formatPlays(track.play_count)}</span>
                )}
                {track.duration > 0 && (
                  <span className="label w-10 text-right text-ink-3 tabular-nums">
                    {formatDuration(track.duration)}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </Disclosure>
    </div>
  )
}

function Fact({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 rounded-xl bg-paper-3 px-3 py-2.5">
      <p className="text-[1.35rem] font-semibold leading-none text-ink">{value}</p>
      <p className="label mt-1 text-ink-3">{label}</p>
    </div>
  )
}

function resolveTags(data: MusicData, ids: string[]): Tag[] {
  if (!ids?.length) return []
  const byId = new Map(data.tags.map((t) => [t.id, t]))
  return ids.map((id) => byId.get(id)).filter((t): t is Tag => Boolean(t))
}
