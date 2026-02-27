import { useEffect, useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import pb from '@/lib/pocketbase'
import type { Artist, Tag } from '@/types/pocketbase'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

type ArtistWithTags = Artist & { expand?: { tag_relations?: Tag[] } }

const PER_PAGE = 50

function formatPlays(count: number): string {
  return count.toLocaleString() + ' plays'
}

function ArtistCardSkeleton() {
  return (
    <Card className="border-border/50 px-4 py-3">
      <div className="space-y-2">
        <Skeleton className="h-5 w-3/4" />
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-12" />
        </div>
      </div>
    </Card>
  )
}

function ArtistCard({ artist }: { artist: ArtistWithTags }) {
  const navigate = useNavigate()
  const expandedTags = (artist.expand?.tag_relations ?? []).slice(0, 3)
  const fallbackTags = expandedTags.length === 0 ? (artist.tags?.slice(0, 3) ?? []) : []

  return (
    <Card
      className="cursor-pointer border-border/50 px-4 py-3 transition-colors hover:border-primary/40 hover:bg-accent"
      onClick={() => navigate(`/artists/${artist.id}`)}
    >
      <h3 className="truncate font-semibold text-card-foreground">{artist.name}</h3>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="font-normal">
          {formatPlays(artist.play_count)}
        </Badge>
        {expandedTags.map(tag => (
          <Link key={tag.id} to={`/tags/${tag.id}`} onClick={e => e.stopPropagation()}>
            <Badge variant="outline" className="text-xs font-normal text-muted-foreground transition-colors hover:text-primary">
              {tag.name}
            </Badge>
          </Link>
        ))}
        {fallbackTags.map(tag => (
          <Badge key={tag} variant="outline" className="text-xs font-normal text-muted-foreground">
            {tag}
          </Badge>
        ))}
      </div>
    </Card>
  )
}

export default function ArtistsPage() {
  const [artists, setArtists] = useState<ArtistWithTags[]>([])
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
        const result = await pb.collection('artists').getList<ArtistWithTags>(1, PER_PAGE, {
          sort: '-play_count',
          expand: 'tag_relations',
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
      const result = await pb.collection('artists').getList<ArtistWithTags>(nextPage, PER_PAGE, {
        sort: '-play_count',
        expand: 'tag_relations',
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
