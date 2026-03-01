import { useEffect, useState, useMemo, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import pb from '@/lib/pocketbase'
import type { Artist, Tag } from '@/types/pocketbase'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

type ArtistWithTags = Artist & { expand?: { tag_relations?: Tag[] } }

const PER_PAGE = 50

function formatPlays(count: number): string {
  return count.toLocaleString() + ' plays'
}

function getInitials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
}

function getGradientForName(name: string): string {
  let hash = 0
  for (const ch of name) hash = ch.charCodeAt(0) + ((hash << 5) - hash)
  const base = Math.abs(hash % 60)
  const hue1 = 25 + base
  const hue2 = (hue1 + 30) % 360
  return `linear-gradient(135deg, hsl(${hue1}, 55%, 28%), hsl(${hue2}, 45%, 18%))`
}

function ArtistCardSkeleton() {
  return (
    <Skeleton className="aspect-square w-full rounded-xl" />
  )
}

function ArtistCard({ artist }: { artist: ArtistWithTags }) {
  const navigate = useNavigate()
  const [imgError, setImgError] = useState(false)
  const expandedTags = (artist.expand?.tag_relations ?? []).slice(0, 2)

  const handleImgError = useCallback(() => setImgError(true), [])

  return (
    <div
      className="card-hover group relative aspect-square cursor-pointer overflow-hidden rounded-xl album-art-shadow-sm"
      onClick={() => navigate(`/artists/${artist.id}`)}
    >
      {artist.image_url && !imgError ? (
        <img
          src={artist.image_url}
          alt={artist.name}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
          onError={handleImgError}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-3xl font-light text-white/80"
          style={{ background: getGradientForName(artist.name) }}
        >
          {getInitials(artist.name)}
        </div>
      )}
      <div className="album-card-gradient absolute inset-0" />
      <div className="absolute bottom-0 left-0 right-0 p-3">
        <h3 className="truncate text-sm font-medium text-white">{artist.name}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-white/50">
            {formatPlays(artist.play_count)}
          </span>
          {expandedTags.map(tag => (
            <Link key={tag.id} to={`/tags/${tag.id}`} onClick={e => e.stopPropagation()}>
              <Badge variant="outline" className="h-auto border-white/20 px-1.5 py-0 text-[10px] font-normal text-white/60 transition-colors hover:text-primary">
                {tag.name}
              </Badge>
            </Link>
          ))}
        </div>
      </div>
    </div>
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
    <div className="px-4 py-6">
      <h1 className="page-title mb-5 text-3xl">Artists</h1>

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search artists..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-10 rounded-xl border-none bg-card pl-9"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <ArtistCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <p className="py-12 text-center text-destructive">{error}</p>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {search ? 'No artists match your search.' : 'No artists found.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {filtered.map(artist => (
              <ArtistCard key={artist.id} artist={artist} />
            ))}
          </div>

          {hasMore && !search && (
            <div className="mb-4 mt-8 flex justify-center">
              <Button
                variant="outline"
                className="rounded-xl border-none bg-card text-sm hover:bg-accent"
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
