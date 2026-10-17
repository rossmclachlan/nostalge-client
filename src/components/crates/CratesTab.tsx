import { useMemo, useState } from 'react'
import type { MusicData } from '@/lib/types'
import { allAlbums } from '@/lib/derive'
import { CoverTile } from '../CoverTile'
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
      <label className="mb-4 flex items-center gap-2 rounded-full border-[1.5px] border-kraft bg-paper-2 px-4 py-2 focus-within:border-ink">
        <SearchIcon className="h-[18px] w-[18px] shrink-0 text-ink-3" />
        <span className="sr-only">Search {data.albums.length} records</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Flip through ${data.albums.length} records`}
          className="w-full bg-transparent text-[0.95rem] text-ink placeholder:text-ink-3 focus:outline-none"
        />
      </label>

      {albums.length === 0 ? (
        <p className="label text-ink-3 mt-8 text-center">No records match “{query}”</p>
      ) : (
        <div className="grid grid-cols-3 gap-x-2.5 gap-y-3.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {albums.map((album) => (
            <CoverTile
              key={album.id}
              title={album.title}
              subtitle={album.artistName}
              src={album.image_url}
              onClick={() => onOpenAlbum(album.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
