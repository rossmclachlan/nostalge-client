import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Disc3, Copy, Check } from 'lucide-react'
import pb from '@/lib/pocketbase'
import type { Tag, Artist, Album } from '@/types/pocketbase'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const PER_PAGE = 50

type AlbumWithArtist = Album & { expand?: { artist?: Artist } }

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

/* ── Artist card ── */

function ArtistCardSkeleton() {
  return (
    <Skeleton className="h-16 w-full rounded-xl" />
  )
}

function ArtistCard({ artist }: { artist: Artist }) {
  const [imgError, setImgError] = useState(false)
  const tags = artist.tags?.slice(0, 3) ?? []

  return (
    <Link to={`/artists/${artist.id}`}>
      <div className="card-hover flex items-center gap-3 rounded-xl bg-card p-3 transition-colors hover:bg-accent">
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg">
          {artist.image_url && !imgError ? (
            <img
              src={artist.image_url}
              alt={artist.name}
              className="h-full w-full object-cover"
              loading="lazy"
              onError={() => setImgError(true)}
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center text-xs font-light text-white/80"
              style={{ background: getGradientForName(artist.name) }}
            >
              {getInitials(artist.name)}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-white">{artist.name}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{formatPlays(artist.play_count)}</span>
            {tags.map(tag => (
              <span key={tag} className="text-[10px] text-muted-foreground/60">{tag}</span>
            ))}
          </div>
        </div>
      </div>
    </Link>
  )
}

/* ── Album card ── */

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
          <span className="text-[10px] text-white/50">{formatPlays(album.play_count)}</span>
        </div>
      </Link>
      <CopyButton text={copyText} />
    </div>
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
      <div className="px-4 py-6">
        <Skeleton className="mb-5 h-10 w-48" />

        <h2 className="section-heading mb-4 text-lg">Artists</h2>
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <ArtistCardSkeleton key={i} />
          ))}
        </div>

        <h2 className="section-heading mb-4 mt-10 text-lg">Albums</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <AlbumCardSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 py-6">
        <Link to="/tags" className="mb-5 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          Tags
        </Link>
        <p className="py-12 text-center text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className="px-4 py-6">
      <Link to="/tags" className="mb-5 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
        Tags
      </Link>

      <h1 className="page-title mb-8 text-3xl">{tag?.name}</h1>

      {/* Artists section */}
      <h2 className="section-heading mb-4 text-lg">Artists</h2>
      {artists.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No artists found for this tag.</p>
      ) : (
        <>
          <div className="space-y-2">
            {artists.map(artist => (
              <ArtistCard key={artist.id} artist={artist} />
            ))}
          </div>
          {hasMoreArtists && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                className="rounded-xl border-none bg-card text-sm hover:bg-accent"
                onClick={loadMoreArtists}
                disabled={loadingMoreArtists}
              >
                {loadingMoreArtists ? 'Loading...' : 'Load more artists'}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Albums section */}
      <h2 className="section-heading mb-4 mt-10 text-lg">Albums</h2>
      {albums.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No albums found for this tag.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {albums.map(album => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
          {hasMoreAlbums && (
            <div className="mb-4 mt-6 flex justify-center">
              <Button
                variant="outline"
                className="rounded-xl border-none bg-card text-sm hover:bg-accent"
                onClick={loadMoreAlbums}
                disabled={loadingMoreAlbums}
              >
                {loadingMoreAlbums ? 'Loading...' : 'Load more albums'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
