import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Disc3 } from 'lucide-react'
import DOMPurify from 'dompurify'
import pb from '@/lib/pocketbase'
import type { Artist, Album, Tag } from '@/types/pocketbase'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

type ArtistWithTags = Artist & { expand?: { tag_relations?: Tag[] } }

function formatPlays(count: number): string {
  return count.toLocaleString() + ' plays'
}

function formatListeners(count: number): string {
  return count.toLocaleString() + ' listeners'
}

function parseSimilarArtistName(entry: unknown): string | null {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object' && 'name' in entry && typeof (entry as { name: unknown }).name === 'string') {
    return (entry as { name: string }).name
  }
  return null
}

// --- Skeleton loaders ---

function HeroSkeleton() {
  return (
    <div className="space-y-3 text-center">
      <Skeleton className="mx-auto h-9 w-56" />
      <div className="flex justify-center gap-2">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="flex justify-center gap-1.5">
        <Skeleton className="h-5 w-14" />
        <Skeleton className="h-5 w-14" />
        <Skeleton className="h-5 w-14" />
      </div>
    </div>
  )
}

function BioSkeleton() {
  return (
    <Card className="border-border/50">
      <CardContent className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </CardContent>
    </Card>
  )
}

function AlbumGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="gap-0 overflow-hidden border-border/50 p-0">
          <Skeleton className="aspect-square w-full rounded-none" />
          <div className="space-y-2 p-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </Card>
      ))}
    </div>
  )
}

function SimilarArtistsSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="shrink-0">
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  )
}

// --- Bio section ---

function BioSection({ bio }: { bio: string }) {
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = contentRef.current
    if (el) {
      // line-clamp-3 at text-sm ~ 3 * 1.25rem line-height = 60px
      setClamped(el.scrollHeight > el.clientHeight + 2)
    }
  }, [bio])

  const sanitized = DOMPurify.sanitize(bio, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
  })

  return (
    <Card className="border-border/50">
      <CardContent>
        <h2 className="mb-3 text-lg font-semibold">About</h2>
        <div
          ref={contentRef}
          className={`prose-invert text-sm leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline ${expanded ? '' : 'line-clamp-3'}`}
          dangerouslySetInnerHTML={{ __html: sanitized }}
        />
        {(clamped || expanded) && (
          <Button
            variant="link"
            size="sm"
            className="mt-1 h-auto p-0 text-xs"
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? 'Show less' : 'Read more'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

// --- Album card ---

function AlbumCard({ album }: { album: Album }) {
  const [imgError, setImgError] = useState(false)

  return (
    <Link to={`/albums/${album.id}`}>
      <Card className="group gap-0 overflow-hidden border-border/50 p-0 transition-colors hover:border-primary/40 hover:bg-accent">
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
        <div className="p-3">
          <h3 className="truncate font-semibold text-card-foreground">{album.title}</h3>
          <Badge variant="secondary" className="mt-1.5 font-normal">
            {formatPlays(album.play_count)}
          </Badge>
        </div>
      </Card>
    </Link>
  )
}

// --- Similar artist pill ---

function SimilarArtistPill({ name, artist }: { name: string; artist?: Artist }) {
  if (artist) {
    return (
      <Link to={`/artists/${artist.id}`}>
        <Badge variant="secondary" className="font-normal transition-colors hover:bg-accent hover:text-primary">
          {name}
        </Badge>
      </Link>
    )
  }
  return (
    <Badge variant="secondary" className="font-normal">
      {name}
    </Badge>
  )
}

// --- Main page ---

export default function ArtistDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [artist, setArtist] = useState<ArtistWithTags | null>(null)
  const [albums, setAlbums] = useState<Album[]>([])
  const [similarMap, setSimilarMap] = useState<Record<string, Artist>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [heroImgError, setHeroImgError] = useState(false)

  const fetchData = useCallback(async (artistId: string) => {
    setLoading(true)
    setError(null)
    setHeroImgError(false)
    try {
      const [artistRecord, albumsResult] = await Promise.all([
        pb.collection('artists').getOne<ArtistWithTags>(artistId, { expand: 'tag_relations', requestKey: null }),
        pb.collection('albums').getFullList<Album>({
          filter: `artist = "${artistId}"`,
          sort: '-play_count',
          requestKey: null,
        }),
      ])

      setArtist(artistRecord)
      setAlbums(albumsResult)

      // Resolve similar artists — look up by name
      const names = (artistRecord.similar_artists ?? [])
        .map(parseSimilarArtistName)
        .filter((n): n is string => n !== null)
      if (names.length) {
        const filterExpr = names.map(n => `name = "${n.replace(/"/g, '\\"')}"`).join(' || ')
        try {
          const similar = await pb.collection('artists').getFullList<Artist>({
            filter: filterExpr,
            requestKey: null,
          })
          const map: Record<string, Artist> = {}
          for (const a of similar) {
            map[a.name] = a
          }
          setSimilarMap(map)
        } catch {
          // Non-critical — just show names without links
          setSimilarMap({})
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(`Failed to load artist: ${message}`)
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (id) fetchData(id)
  }, [id, fetchData])

  return (
    <div className="p-4">
      {/* Header with back button */}
      <div className="mb-4 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/artists')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="truncate text-lg font-semibold">
          {loading ? <Skeleton className="h-6 w-32" /> : artist?.name ?? 'Artist'}
        </h1>
      </div>

      {loading ? (
        <div className="space-y-6">
          <HeroSkeleton />
          <BioSkeleton />
          <div>
            <Skeleton className="mb-3 h-6 w-24" />
            <AlbumGridSkeleton />
          </div>
          <div>
            <Skeleton className="mb-3 h-6 w-32" />
            <SimilarArtistsSkeleton />
          </div>
        </div>
      ) : error ? (
        <p className="py-12 text-center text-destructive">{error}</p>
      ) : artist ? (
        <div className="space-y-6">
          {/* Hero section */}
          {artist.image_url && !heroImgError ? (
            <div className="relative h-[250px] overflow-hidden rounded-xl md:h-[350px]">
              <img
                src={artist.image_url}
                alt={artist.name}
                className="h-full w-full object-cover"
                loading="lazy"
                onError={() => setHeroImgError(true)}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-4">
                <h2 className="text-3xl font-bold drop-shadow-lg">{artist.name}</h2>
                <div className="mt-2 flex gap-2">
                  <Badge>{formatPlays(artist.play_count)}</Badge>
                  {artist.listener_count > 0 && (
                    <Badge variant="secondary">{formatListeners(artist.listener_count)}</Badge>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <h2 className="text-3xl font-bold">{artist.name}</h2>
              <div className="mt-3 flex justify-center gap-2">
                <Badge>{formatPlays(artist.play_count)}</Badge>
                {artist.listener_count > 0 && (
                  <Badge variant="secondary">{formatListeners(artist.listener_count)}</Badge>
                )}
              </div>
            </div>
          )}

          {/* Tags */}
          {(() => {
            const expandedTags = artist.expand?.tag_relations ?? []
            const fallbackTags = expandedTags.length === 0 ? (artist.tags ?? []) : []
            if (expandedTags.length === 0 && fallbackTags.length === 0) return null
            return (
              <div className="-mt-3 flex flex-wrap justify-center gap-1.5">
                {expandedTags.map(tag => (
                  <Link key={tag.id} to={`/tags/${tag.id}`}>
                    <Badge variant="outline" className="text-xs font-normal transition-colors hover:bg-accent hover:text-primary">
                      {tag.name}
                    </Badge>
                  </Link>
                ))}
                {fallbackTags.map(tag => (
                  <Badge key={tag} variant="outline" className="text-xs font-normal">
                    {tag}
                  </Badge>
                ))}
              </div>
            )
          })()}

          {/* Bio */}
          {artist.bio && <BioSection bio={artist.bio} />}

          {/* Albums */}
          {albums.length > 0 && (
            <div>
              <h2 className="mb-3 text-lg font-semibold">Albums</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                {albums.map(album => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </div>
            </div>
          )}

          {/* Similar artists */}
          {(() => {
            const names = (artist.similar_artists ?? [])
              .map(parseSimilarArtistName)
              .filter((n): n is string => n !== null)
            return names.length > 0 ? (
              <div>
                <h2 className="mb-3 text-lg font-semibold">Similar Artists</h2>
                <div className="flex flex-wrap gap-2">
                  {names.map(name => (
                    <SimilarArtistPill
                      key={name}
                      name={name}
                      artist={similarMap[name]}
                    />
                  ))}
                </div>
              </div>
            ) : null
          })()}
        </div>
      ) : null}
    </div>
  )
}
