import { useMemo, useState } from 'react'
import type { Artist, MusicData } from '@/lib/types'
import { formatPlays } from '@/lib/format'
import { Cover } from '../Cover'
import { EmptyState } from '../ui'
import { SearchIcon } from '../icons'

export function CratesTab({
  data,
  onOpenArtist,
}: {
  data: MusicData
  onOpenArtist: (id: string) => void
}) {
  const [query, setQuery] = useState('')

  const artists = useMemo(() => {
    const sorted = [...data.artists].sort((a, b) => b.play_count - a.play_count)
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((a) => a.name.toLowerCase().includes(q))
  }, [data.artists, query])

  if (data.artists.length === 0) {
    return (
      <EmptyState
        title="Empty crates"
        body="Nothing's been filed away yet. Once your library syncs, your artists land here — even with the shop's wifi down."
      />
    )
  }

  return (
    <div>
      <p className="label text-ink-3 mb-2">{data.artists.length} artists on the shelf</p>

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

      {artists.length === 0 ? (
        <p className="label text-ink-3 mt-8 text-center">
          No artists match “{query}”
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3.5">
          {artists.map((artist, i) => (
            <ArtistCard
              key={artist.id}
              artist={artist}
              tilt={i % 2 === 0 ? 'tilt-l' : 'tilt-r'}
              onClick={() => onOpenArtist(artist.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ArtistCard({
  artist,
  tilt,
  onClick,
}: {
  artist: Artist
  tilt: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flyer group block p-2 text-left transition-transform active:translate-y-[2px] active:shadow-none"
    >
      <div className={tilt}>
        <Cover name={artist.name} src={artist.image_url} />
      </div>
      <div className="mt-2 flex items-end justify-between gap-1">
        <h3 className="font-display text-xl leading-none text-ink line-clamp-2 uppercase">
          {artist.name}
        </h3>
      </div>
      {artist.play_count > 0 && (
        <p className="label text-ink-3 mt-1">{formatPlays(artist.play_count)} plays</p>
      )}
    </button>
  )
}
