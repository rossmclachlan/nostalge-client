import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Search, Disc3, Copy, Check } from 'lucide-react'
import pb from '@/lib/pocketbase'
import type { Album, Artist, Tag } from '@/types/pocketbase'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const PER_PAGE = 50

type AlbumWithArtist = Album & { expand?: { artist?: Artist; tag_relations?: Tag[] } }

function formatPlays(count: number): string {
  return count.toLocaleString() + ' plays'
}

function AlbumCardSkeleton() {
  return (
    <Skeleton className="aspect-square w-full rounded-xl" />
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="absolute right-1.5 top-1.5 z-10 h-7 w-7 bg-black/50 opacity-100 backdrop-blur-sm transition-opacity md:opacity-0 md:group-hover:opacity-100"
      onClick={handleCopy}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-primary" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-white" />
      )}
    </Button>
  )
}

function AlbumCard({ album }: { album: AlbumWithArtist }) {
  const [imgError, setImgError] = useState(false)
  const artist = album.expand?.artist
  const copyText = `${artist?.name ?? 'Unknown artist'} - ${album.title}`

  return (
    <div className="card-hover group relative aspect-square overflow-hidden rounded-xl album-art-shadow-sm">
      <Link to={`/albums/${album.id}`}>
        {album.image_url && !imgError ? (
          <img
            src={album.image_url}
            alt={album.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-accent text-muted-foreground">
            <Disc3 className="h-12 w-12" strokeWidth={1.5} />
          </div>
        )}
        <div className="album-card-gradient absolute inset-0" />
        <div className="absolute bottom-0 left-0 right-0 p-3">
          <h3 className="truncate text-sm font-medium text-white">{album.title}</h3>
          <p className="truncate text-xs text-white/70">
            {artist?.name ?? 'Unknown artist'}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-white/50">{formatPlays(album.play_count)}</span>
            {(album.expand?.tag_relations ?? []).slice(0, 1).map(tag => (
              <span key={tag.id} className="text-[10px] text-primary/80">
                {tag.name}
              </span>
            ))}
          </div>
        </div>
      </Link>
      <CopyButton text={copyText} />
    </div>
  )
}

export default function AlbumsPage() {
  const [albums, setAlbums] = useState<AlbumWithArtist[]>([])
  const [page, setPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false

    async function fetchAlbums() {
      try {
        setLoading(true)
        setError(null)
        const result = await pb.collection('albums').getList<AlbumWithArtist>(1, PER_PAGE, {
          sort: '-play_count',
          expand: 'artist,tag_relations',
        })
        if (!cancelled) {
          setAlbums(result.items)
          setTotalItems(result.totalItems)
          setPage(1)
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          setError(`Failed to load albums: ${message}`)
          console.error(err)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchAlbums()
    return () => { cancelled = true }
  }, [])

  async function loadMore() {
    const nextPage = page + 1
    setLoadingMore(true)
    try {
      const result = await pb.collection('albums').getList<AlbumWithArtist>(nextPage, PER_PAGE, {
        sort: '-play_count',
        expand: 'artist,tag_relations',
      })
      setAlbums(prev => [...prev, ...result.items])
      setPage(nextPage)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingMore(false)
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return albums
    const q = search.toLowerCase()
    return albums.filter(a =>
      a.title.toLowerCase().includes(q) ||
      (a.expand?.artist?.name?.toLowerCase().includes(q) ?? false)
    )
  }, [albums, search])

  const hasMore = albums.length < totalItems

  return (
    <div className="px-4 py-6">
      <h1 className="page-title mb-5 text-3xl">Albums</h1>

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search albums or artists..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-10 rounded-xl border-none bg-card pl-9"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <AlbumCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <p className="py-12 text-center text-destructive">{error}</p>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {search ? 'No albums match your search.' : 'No albums found.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {filtered.map(album => (
              <AlbumCard key={album.id} album={album} />
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
