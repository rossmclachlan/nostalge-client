import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Disc3, Copy, Check } from 'lucide-react'
import pb from '@/lib/pocketbase'
import type { Tag, Artist, Album } from '@/types/pocketbase'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const PER_PAGE = 50

type AlbumWithArtist = Album & { expand?: { artist?: Artist } }

function formatPlays(count: number): string {
  return count.toLocaleString() + ' plays'
}

/* ── Artist card (same as ArtistsPage) ── */

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

function ArtistCard({ artist }: { artist: Artist }) {
  const tags = artist.tags?.slice(0, 3) ?? []

  return (
    <Link to={`/artists/${artist.id}`}>
      <Card className="border-border/50 px-4 py-3 transition-colors hover:border-primary/40 hover:bg-accent">
        <h3 className="truncate font-semibold text-card-foreground">{artist.name}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="font-normal">
            {formatPlays(artist.play_count)}
          </Badge>
          {tags.map(tag => (
            <Badge key={tag} variant="outline" className="text-xs font-normal text-muted-foreground">
              {tag}
            </Badge>
          ))}
        </div>
      </Card>
    </Link>
  )
}

/* ── Album card (same as AlbumsPage) ── */

function AlbumCardSkeleton() {
  return (
    <Card className="gap-0 overflow-hidden border-border/50 p-0">
      <Skeleton className="aspect-square w-full rounded-none" />
      <div className="space-y-2 p-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-5 w-16" />
      </div>
    </Card>
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
      className="absolute right-1.5 top-1.5 h-7 w-7 bg-background/70 opacity-100 backdrop-blur-sm transition-opacity md:opacity-0 md:group-hover:opacity-100"
      onClick={handleCopy}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-primary" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  )
}

function AlbumCard({ album }: { album: AlbumWithArtist }) {
  const [imgError, setImgError] = useState(false)
  const artist = album.expand?.artist
  const copyText = `${artist?.name ?? 'Unknown artist'} - ${album.title}`

  return (
    <Card className="group relative gap-0 overflow-hidden border-border/50 p-0 transition-colors hover:border-primary/40 hover:bg-accent">
      <Link to={`/albums/${album.id}`}>
        <div className="aspect-square overflow-hidden bg-accent">
          {album.image_url && !imgError ? (
            <img
              src={album.image_url}
              alt={album.title}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              onError={() => setImgError(true)}
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Disc3 className="h-12 w-12" strokeWidth={1.5} />
            </div>
          )}
        </div>
      </Link>
      <CopyButton text={copyText} />
      <div className="p-3">
        <Link to={`/albums/${album.id}`}>
          <h3 className="truncate font-semibold text-card-foreground">{album.title}</h3>
        </Link>
        {artist ? (
          <Link
            to={`/artists/${artist.id}`}
            className="mt-0.5 block truncate text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            {artist.name}
          </Link>
        ) : (
          <p className="mt-0.5 truncate text-sm text-muted-foreground">Unknown artist</p>
        )}
        <Badge variant="secondary" className="mt-1.5 font-normal">
          {formatPlays(album.play_count)}
        </Badge>
      </div>
    </Card>
  )
}

/* ── Tag detail page ── */

export default function TagDetailPage() {
  const { id: tagId } = useParams<{ id: string }>()

  const [tag, setTag] = useState<Tag | null>(null)
  const [artists, setArtists] = useState<Artist[]>([])
  const [albums, setAlbums] = useState<AlbumWithArtist[]>([])
  const [artistPage, setArtistPage] = useState(1)
  const [albumPage, setAlbumPage] = useState(1)
  const [totalArtists, setTotalArtists] = useState(0)
  const [totalAlbums, setTotalAlbums] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMoreArtists, setLoadingMoreArtists] = useState(false)
  const [loadingMoreAlbums, setLoadingMoreAlbums] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tagId) return
    let cancelled = false

    async function fetchTagData() {
      try {
        setLoading(true)
        setError(null)

        const [tagRecord, artistsResult, albumsResult] = await Promise.all([
          pb.collection('tags').getOne<Tag>(tagId!, { requestKey: null }),
          pb.collection('artists').getList<Artist>(1, PER_PAGE, {
            filter: `tag_relations~"${tagId}"`,
            sort: '-play_count',
            requestKey: null,
          }),
          pb.collection('albums').getList<AlbumWithArtist>(1, PER_PAGE, {
            filter: `tag_relations~"${tagId}"`,
            sort: '-play_count',
            expand: 'artist',
            requestKey: null,
          }),
        ])

        if (!cancelled) {
          setTag(tagRecord)
          setArtists(artistsResult.items)
          setTotalArtists(artistsResult.totalItems)
          setArtistPage(1)
          setAlbums(albumsResult.items)
          setTotalAlbums(albumsResult.totalItems)
          setAlbumPage(1)
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          setError(`Failed to load tag: ${message}`)
          console.error(err)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchTagData()
    return () => { cancelled = true }
  }, [tagId])

  async function loadMoreArtists() {
    if (!tagId) return
    const nextPage = artistPage + 1
    setLoadingMoreArtists(true)
    try {
      const result = await pb.collection('artists').getList<Artist>(nextPage, PER_PAGE, {
        filter: `tag_relations~"${tagId}"`,
        sort: '-play_count',
      })
      setArtists(prev => [...prev, ...result.items])
      setArtistPage(nextPage)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingMoreArtists(false)
    }
  }

  async function loadMoreAlbums() {
    if (!tagId) return
    const nextPage = albumPage + 1
    setLoadingMoreAlbums(true)
    try {
      const result = await pb.collection('albums').getList<AlbumWithArtist>(nextPage, PER_PAGE, {
        filter: `tag_relations~"${tagId}"`,
        sort: '-play_count',
        expand: 'artist',
      })
      setAlbums(prev => [...prev, ...result.items])
      setAlbumPage(nextPage)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingMoreAlbums(false)
    }
  }

  const hasMoreArtists = artists.length < totalArtists
  const hasMoreAlbums = albums.length < totalAlbums

  if (loading) {
    return (
      <div className="p-4">
        <Skeleton className="mb-4 h-8 w-48" />

        <h2 className="mb-3 text-lg font-semibold">Artists</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <ArtistCardSkeleton key={i} />
          ))}
        </div>

        <h2 className="mb-3 mt-8 text-lg font-semibold">Albums</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <AlbumCardSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <Link to="/tags" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Tags
        </Link>
        <p className="py-12 text-center text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className="p-4">
      <Link to="/tags" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" />
        Tags
      </Link>

      <h1 className="mb-6 text-2xl font-bold">{tag?.name}</h1>

      {/* Artists section */}
      <h2 className="mb-3 text-lg font-semibold">Artists</h2>
      {artists.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">No artists found for this tag.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {artists.map(artist => (
              <ArtistCard key={artist.id} artist={artist} />
            ))}
          </div>
          {hasMoreArtists && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={loadMoreArtists} disabled={loadingMoreArtists}>
                {loadingMoreArtists ? 'Loading...' : 'Load more artists'}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Albums section */}
      <h2 className="mb-3 mt-8 text-lg font-semibold">Albums</h2>
      {albums.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">No albums found for this tag.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {albums.map(album => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
          {hasMoreAlbums && (
            <div className="mb-4 mt-4 flex justify-center">
              <Button variant="outline" onClick={loadMoreAlbums} disabled={loadingMoreAlbums}>
                {loadingMoreAlbums ? 'Loading...' : 'Load more albums'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
