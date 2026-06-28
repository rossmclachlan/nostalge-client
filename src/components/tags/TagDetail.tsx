import { useMemo, useState } from 'react'
import type { MusicData } from '@/lib/types'
import { albumsForTag, artistsForTag, type AlbumWithArtist } from '@/lib/derive'
import { formatPlays } from '@/lib/format'
import { Cover } from '../Cover'
import { DetailHeader } from '../DetailHeader'

/** Fisher–Yates shuffle (returns a new array). */
function shuffle<T>(input: T[]): T[] {
  const arr = [...input]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function TagDetail({
  data,
  tagId,
  onBack,
  onOpenArtist,
  onOpenAlbum,
}: {
  data: MusicData
  tagId: string
  onBack: () => void
  onOpenArtist: (id: string) => void
  onOpenAlbum: (id: string) => void
}) {
  const tag = data.tags.find((t) => t.id === tagId)
  const artists = useMemo(() => artistsForTag(data, tagId), [data, tagId])
  const albums = useMemo(() => albumsForTag(data, tagId), [data, tagId])

  // null = default order (by plays); otherwise a shuffled snapshot.
  const [shuffled, setShuffled] = useState<AlbumWithArtist[] | null>(null)
  const displayAlbums = shuffled ?? albums

  return (
    <div>
      <DetailHeader title="Tag" onBack={onBack} />

      <div className="p-4">
        <p className="label text-riso-red mb-1">filed under</p>
        <h1 className="stamp-title text-[2.75rem] break-words">{tag?.name ?? 'Unknown'}</h1>

        {/* Albums first */}
        {albums.length > 0 && (
          <>
            <div className="mt-6 mb-3 flex items-center justify-between gap-3">
              <h2 className="stamp-title text-[1.6rem]">Albums</h2>
              <button
                onClick={() => setShuffled(shuffle(albums))}
                className="btn-press px-3 py-1.5 text-xs"
              >
                ↻ Shuffle
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
              {displayAlbums.map((album, i) => (
                <button
                  key={album.id}
                  onClick={() => onOpenAlbum(album.id)}
                  className="flyer block p-2 text-left transition-transform active:translate-y-[2px] active:shadow-none"
                >
                  <div className={i % 2 === 0 ? 'tilt-l' : 'tilt-r'}>
                    <Cover name={album.title} src={album.image_url} />
                  </div>
                  <h3 className="font-display mt-2 text-lg leading-none text-ink uppercase line-clamp-2">
                    {album.title}
                  </h3>
                  <p className="label text-ink-3 mt-1 truncate">{album.artistName}</p>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Artists below */}
        {artists.length > 0 && (
          <>
            <h2 className="stamp-title mt-8 mb-3 text-[1.6rem]">Artists</h2>
            <div className="flex flex-wrap gap-2">
              {artists.map((a) => (
                <button
                  key={a.id}
                  onClick={() => onOpenArtist(a.id)}
                  className="btn-press px-2.5 py-1 text-sm"
                >
                  {a.name}
                  {a.play_count > 0 && (
                    <span className="label text-ink-3 ml-1.5">
                      {formatPlays(a.play_count)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {artists.length === 0 && albums.length === 0 && (
          <p className="label text-ink-3 mt-6">Nothing filed under this divider yet.</p>
        )}
      </div>
    </div>
  )
}
