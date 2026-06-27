import { useMemo, useState } from 'react'
import type { MusicData } from '@/lib/types'
import { allAlbums, type AlbumWithArtist } from '@/lib/derive'
import { formatPlays } from '@/lib/format'
import { Cover } from '../Cover'
import { EmptyState } from '../ui'
import { SearchIcon } from '../icons'

export function CratesTab({
  data,
  onOpenAlbum,
}: {
  data: MusicData
  onOpenAlbum: (id: string) => void
}) {
  const [query, setQuery] = useState('')

  const albums = useMemo(() => {
    const sorted = allAlbums(data).sort((a, b) => b.play_count - a.play_count)
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.artistName.toLowerCase().includes(q),
    )
  }, [data, query])

  if (data.albums.length === 0) {
    return (
      <EmptyState
        title="Empty crates"
        body="Nothing's been filed away yet. Once your library syncs, your albums land here — even with the shop's wifi down."
      />
    )
  }

  return (
    <div>
      <p className="label text-ink-3 mb-2">{data.albums.length} sleeves in the crate</p>

      {/* Search */}
      <div className="flyer mb-5 flex items-center gap-2 px-3 py-2">
        <SearchIcon className="h-5 w-5 text-ink-3" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Flip through the crates…"
          className="w-full bg-transparent text-ink placeholder:text-ink-3 focus:outline-none"
        />
      </div>

      {albums.length === 0 ? (
        <p className="label text-ink-3 mt-8 text-center">No albums match “{query}”</p>
      ) : (
        <div className="grid grid-cols-2 gap-3.5">
          {albums.map((album, i) => (
            <AlbumCard
              key={album.id}
              album={album}
              tilt={i % 2 === 0 ? 'tilt-l' : 'tilt-r'}
              onClick={() => onOpenAlbum(album.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AlbumCard({
  album,
  tilt,
  onClick,
}: {
  album: AlbumWithArtist
  tilt: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flyer block p-2 text-left transition-transform active:translate-y-[2px] active:shadow-none"
    >
      <div className={tilt}>
        <Cover name={album.title} src={album.image_url} />
      </div>
      <h3 className="font-display mt-2 text-lg leading-none text-ink uppercase line-clamp-2">
        {album.title}
      </h3>
      <p className="label text-ink-3 mt-1 truncate">{album.artistName}</p>
      {album.play_count > 0 && (
        <p className="label text-ink-3 mt-0.5">{formatPlays(album.play_count)} plays</p>
      )}
    </button>
  )
}
