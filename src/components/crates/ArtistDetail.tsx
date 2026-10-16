import { useMemo } from 'react'
import type { MusicData, Tag } from '@/lib/types'
import { albumsForArtist, similarArtists } from '@/lib/derive'
import { formatPlays, plainText, relativeAge } from '@/lib/format'
import { Chip } from '../ui'
import { CopyButton } from '../CopyButton'
import { CoverRow, CoverTile } from '../CoverTile'
import { DetailHeader } from '../DetailHeader'
import { Disclosure } from '../Disclosure'

export function ArtistDetail({
  data,
  artistId,
  onBack,
  onOpenAlbum,
  onOpenArtist,
  onOpenTag,
}: {
  data: MusicData
  artistId: string
  onBack: () => void
  onOpenAlbum: (id: string) => void
  onOpenArtist: (id: string) => void
  onOpenTag: (id: string) => void
}) {
  const artist = data.artists.find((a) => a.id === artistId)
  const albums = useMemo(() => albumsForArtist(data, artistId), [data, artistId])
  const near = useMemo(() => similarArtists(data, artistId), [data, artistId])
  const tags = useMemo(() => resolveTags(data, artist?.tag_relations ?? []), [data, artist])
  // An artist's face comes from their own image, else their most played sleeve.
  const coverFor = useMemo(() => {
    const top = new Map<string, string>()
    for (const a of [...data.albums].sort((x, y) => y.play_count - x.play_count)) {
      if (a.image_url && !top.has(a.artist)) top.set(a.artist, a.image_url)
    }
    return top
  }, [data])

  if (!artist) {
    return (
      <div>
        <DetailHeader title="Not found" onBack={onBack} />
        <p className="label text-ink-3 p-6">This record's gone missing from the crate.</p>
      </div>
    )
  }

  return (
    <div>
      <DetailHeader title="Artist" onBack={onBack} />

      <div className="px-4 pt-1">
        <h1 className="text-[2.6rem] leading-[0.95] break-words">{artist.name}</h1>
        {tags.length > 0 && (
          <div className="no-scrollbar -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4">
            {tags.slice(0, 8).map((t) => (
              <Chip key={t.id} onClick={() => onOpenTag(t.id)} className="shrink-0">
                {t.name}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {albums.length === 0 ? (
        <p className="label text-ink-3 mt-6 px-4">No albums filed for this artist yet.</p>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-4 px-4 sm:grid-cols-3">
          {albums.map((album) => (
            <CoverTile
              key={album.id}
              title={album.title}
              subtitle={
                album.lastPlayed
                  ? `played ${relativeAge(new Date(album.lastPlayed).toISOString())}`
                  : 'never played'
              }
              src={album.image_url}
              onClick={() => onOpenAlbum(album.id)}
            />
          ))}
        </div>
      )}

      {near.length > 0 && (
        <CoverRow title="Filed near">
          {near.map((a) => (
            <CoverTile
              key={a.id}
              title={a.name}
              src={a.image_url || coverFor.get(a.id)}
              shape="circle"
              onClick={() => onOpenArtist(a.id)}
              className="w-[22%] max-w-[6.5rem] shrink-0 snap-start"
            />
          ))}
        </CoverRow>
      )}

      <Disclosure title="Plays and notes">
        <p className="text-sm text-ink-2">
          <span className="font-semibold text-ink">{formatPlays(artist.play_count)}</span> plays
          across {albums.length} {albums.length === 1 ? 'record' : 'records'}.
        </p>
        {artist.bio && (
          <p className="mt-3 text-sm leading-relaxed text-ink-2">{plainText(artist.bio, 480)}</p>
        )}
        <div className="mt-4">
          <CopyButton text={artist.name} label="Copy name" />
        </div>
      </Disclosure>
    </div>
  )
}

function resolveTags(data: MusicData, ids: string[]): Tag[] {
  if (!ids?.length) return []
  const byId = new Map(data.tags.map((t) => [t.id, t]))
  return ids.map((id) => byId.get(id)).filter((t): t is Tag => Boolean(t))
}
