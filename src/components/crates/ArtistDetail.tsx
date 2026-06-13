import { useMemo } from 'react'
import type { MusicData, Tag } from '@/lib/types'
import { albumsForArtist } from '@/lib/derive'
import { formatPlays, plainText, relativeAge } from '@/lib/format'
import { Cover } from '../Cover'
import { Chip, PlayBadge } from '../ui'
import { DetailHeader } from '../DetailHeader'

export function ArtistDetail({
  data,
  artistId,
  onBack,
  onOpenAlbum,
  onOpenTag,
}: {
  data: MusicData
  artistId: string
  onBack: () => void
  onOpenAlbum: (id: string) => void
  onOpenTag: (id: string) => void
}) {
  const artist = data.artists.find((a) => a.id === artistId)
  const albums = useMemo(() => albumsForArtist(data, artistId), [data, artistId])
  const tags = useMemo(() => resolveTags(data, artist?.tag_relations ?? []), [data, artist])

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

      <div className="p-4">
        {/* Masthead */}
        <div className="flex gap-4">
          <div className="tilt-l w-28 shrink-0">
            <Cover name={artist.name} src={artist.image_url} shape="circle" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="stamp-title text-[2.4rem] break-words">{artist.name}</h1>
            {artist.play_count > 0 && (
              <div className="mt-2">
                <PlayBadge count={artist.play_count} />
              </div>
            )}
          </div>
        </div>

        {tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {tags.slice(0, 6).map((t) => (
              <Chip key={t.id} tone="olive" onClick={() => onOpenTag(t.id)}>
                {t.name}
              </Chip>
            ))}
          </div>
        )}

        {artist.bio && (
          <p className="mt-4 border-l-[3px] border-riso-red pl-3 text-sm leading-relaxed text-ink-2">
            {plainText(artist.bio, 320)}
          </p>
        )}

        {/* Albums as a stack of sleeves */}
        <h2 className="stamp-title mt-8 mb-3 text-[1.75rem]">
          {albums.length} {albums.length === 1 ? 'Sleeve' : 'Sleeves'}
        </h2>

        {albums.length === 0 ? (
          <p className="label text-ink-3">No albums filed for this artist yet.</p>
        ) : (
          <ul className="space-y-3">
            {albums.map((album) => (
              <li key={album.id}>
                <button
                  onClick={() => onOpenAlbum(album.id)}
                  className="flyer flex w-full items-center gap-3 p-2 text-left transition-transform active:translate-y-[2px] active:shadow-none"
                >
                  <div className="w-16 shrink-0">
                    <Cover name={album.title} src={album.image_url} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-xl leading-tight text-ink uppercase line-clamp-2">
                      {album.title}
                    </h3>
                    <p className="label text-ink-3 mt-1">
                      {album.track_count > 0 && `${album.track_count} tracks · `}
                      {album.lastPlayed
                        ? `played ${relativeAge(new Date(album.lastPlayed).toISOString())}`
                        : 'never played'}
                    </p>
                  </div>
                  <span className="price-sticker shrink-0 text-sm">
                    {formatPlays(album.play_count)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
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
