import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Search, User } from 'lucide-react'
import pb from '@/lib/pocketbase'
import type { Artist } from '@/types/pocketbase'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const PER_PAGE = 50

function formatPlays(count: number): string {
  return count.toLocaleString() + ' plays'
}

function ArtistCardSkeleton() {
  return (
    <Card className="gap-0 overflow-hidden border-border/50 p-0">
      <Skeleton className="aspect-square w-full rounded-none" />
      <div className="space-y-2 p-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </Card>
  )
}

function ArtistCard({ artist }: { artist: Artist }) {
  const [imgError, setImgError] = useState(false)

  return (
    <Link to={`/artists/${artist.id}`}>
      <Card className="group gap-0 overflow-hidden border-border/50 p-0 transition-colors hover:border-primary/40 hover:bg-accent">
        <div className="aspect-square overflow-hidden bg-accent">
          {artist.image_url && !imgError ? (
            <img
              src={artist.image_url}
              alt={artist.name}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              onError={() => setImgError(true)}
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <User className="h-12 w-12" strokeWidth={1.5} />
            </div>
          )}
        </div>
        <div className="p-3">
          <h3 className="truncate font-semibold text-card-foreground">{artist.name}</h3>
          <Badge variant="secondary" className="mt-1.5 font-normal">
            {formatPlays(artist.play_count)}
          </Badge>
        </div>
      </Card>
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
      <h1 className="mb-4 text-2xl font-bold">Artists</h1>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search artists..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-10 bg-card pl-9"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <ArtistCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <p className="py-12 text-center text-destructive">{error}</p>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">
          {search ? 'No artists match your search.' : 'No artists found.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {filtered.map(artist => (
              <ArtistCard key={artist.id} artist={artist} />
            ))}
          </div>

          {hasMore && !search && (
            <div className="mb-4 mt-6 flex justify-center">
              <Button
                variant="outline"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading...' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
