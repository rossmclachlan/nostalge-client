import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import pb from '../lib/pocketbase'
import type { Artist } from '../types/pocketbase'

const PER_PAGE = 50

function formatPlays(count: number): string {
  return count.toLocaleString() + ' plays'
}

function ArtistCard({ artist }: { artist: Artist }) {
  const [imgError, setImgError] = useState(false)

  return (
    <Link
      to={`/artists/${artist.id}`}
      className="bg-surface-light rounded-lg overflow-hidden hover:bg-surface-lighter transition-colors group"
    >
      <div className="aspect-square bg-surface-lighter overflow-hidden">
        {artist.image_url && !imgError ? (
          <img
            src={artist.image_url}
            alt={artist.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-muted">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="font-semibold truncate">{artist.name}</h3>
        <p className="text-sm text-text-muted">{formatPlays(artist.play_count)}</p>
      </div>
    </Link>
  )
}

export default function ArtistsPage() {
  const [artists, setArtists] = useState<Artist[]>([])
  const [page, setPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false

    async function fetchArtists() {
      try {
        setLoading(true)
        setError(null)
        const result = await pb.collection('artists').getList<Artist>(1, PER_PAGE, {
          sort: '-play_count',
        })
        if (!cancelled) {
          setArtists(result.items)
          setTotalItems(result.totalItems)
          setPage(1)
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          setError(`Failed to load artists: ${message}`)
          console.error(err)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchArtists()
    return () => { cancelled = true }
  }, [])

  async function loadMore() {
    const nextPage = page + 1
    setLoadingMore(true)
    try {
      const result = await pb.collection('artists').getList<Artist>(nextPage, PER_PAGE, {
        sort: '-play_count',
      })
      setArtists(prev => [...prev, ...result.items])
      setPage(nextPage)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingMore(false)
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return artists
    const q = search.toLowerCase()
    return artists.filter(a => a.name.toLowerCase().includes(q))
  }, [artists, search])

  const hasMore = artists.length < totalItems

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Artists</h1>

      <div className="relative mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search artists..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-surface-light border border-surface-lighter rounded-lg py-2.5 pl-10 pr-4 text-text placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-surface-lighter border-t-primary rounded-full animate-spin" />
        </div>
      ) : error ? (
        <p className="text-center py-12 text-red-400">{error}</p>
      ) : filtered.length === 0 ? (
        <p className="text-center py-12 text-text-muted">
          {search ? 'No artists match your search.' : 'No artists found.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filtered.map(artist => (
              <ArtistCard key={artist.id} artist={artist} />
            ))}
          </div>

          {hasMore && !search && (
            <div className="flex justify-center mt-6 mb-4">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="bg-surface-light hover:bg-surface-lighter border border-surface-lighter rounded-lg px-6 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
              >
                {loadingMore ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
