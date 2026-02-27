import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Disc3 } from 'lucide-react'
import DOMPurify from 'dompurify'
import pb from '@/lib/pocketbase'
import type { Artist, Album, Track } from '@/types/pocketbase'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'

type AlbumWithArtist = Album & { expand?: { artist?: Artist } }

function formatPlays(count: number): string {
  return count.toLocaleString() + ' plays'
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// --- Skeleton loaders ---

function HeroSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="mx-auto aspect-square w-56 rounded-xl" />
      <div className="space-y-2 text-center">
        <Skeleton className="mx-auto h-8 w-48" />
        <Skeleton className="mx-auto h-5 w-32" />
        <div className="flex justify-center gap-2">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-20" />
        </div>
      </div>
    </div>
  )
}

function SummarySkeleton() {
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

function TrackListSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i}>
          {i > 0 && <Separator />}
          <div className="flex items-center gap-3 py-3">
            <Skeleton className="h-4 w-5" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-5 w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}

// --- Wiki summary section ---

function SummarySection({ summary }: { summary: string }) {
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = contentRef.current
    if (el) {
      setClamped(el.scrollHeight > el.clientHeight + 2)
    }
  }, [summary])

  const sanitized = DOMPurify.sanitize(summary, {
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

// --- Track row ---

function TrackRow({ track, index }: { track: Track; index: number }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="w-5 text-right text-sm text-muted-foreground">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{track.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatDuration(track.duration)}</span>
      <Badge variant="secondary" className="shrink-0 font-normal">
        {formatPlays(track.play_count)}
      </Badge>
    </div>
  )
}

// --- Main page ---

export default function AlbumDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [album, setAlbum] = useState<AlbumWithArtist | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [heroImgError, setHeroImgError] = useState(false)

  const fetchData = useCallback(async (albumId: string) => {
    setLoading(true)
    setError(null)
    setHeroImgError(false)
    try {
      const [albumRecord, tracksResult] = await Promise.all([
        pb.collection('albums').getOne<AlbumWithArtist>(albumId, {
          expand: 'artist',
          requestKey: null,
        }),
        pb.collection('tracks').getFullList<Track>({
          filter: `album = "${albumId}"`,
          sort: 'title',
          requestKey: null,
        }),
      ])

      setAlbum(albumRecord)
      setTracks(tracksResult)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(`Failed to load album: ${message}`)
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (id) fetchData(id)
  }, [id, fetchData])

  const artist = album?.expand?.artist

  return (
    <div className="p-4">
      {/* Header with back button */}
      <div className="mb-4 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/albums')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="truncate text-lg font-semibold">
          {loading ? <Skeleton className="h-6 w-32" /> : album?.title ?? 'Album'}
        </h1>
      </div>

      {loading ? (
        <div className="space-y-6">
          <HeroSkeleton />
          <SummarySkeleton />
          <div>
            <Skeleton className="mb-3 h-6 w-20" />
            <TrackListSkeleton />
          </div>
        </div>
      ) : error ? (
        <p className="py-12 text-center text-destructive">{error}</p>
      ) : album ? (
        <div className="space-y-6">
          {/* Hero section */}
          <div className="flex flex-col items-center gap-4">
            <div className="h-56 w-56 overflow-hidden rounded-xl bg-accent shadow-lg">
              {album.image_url && !heroImgError ? (
                <img
                  src={album.image_url}
                  alt={album.title}
                  className="h-full w-full object-cover"
                  onError={() => setHeroImgError(true)}
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <Disc3 className="h-16 w-16" strokeWidth={1.5} />
                </div>
              )}
            </div>
            <div className="text-center">
              <h2 className="text-3xl font-bold">{album.title}</h2>
              {artist ? (
                <Link
                  to={`/artists/${artist.id}`}
                  className="mt-1 inline-block text-base text-primary underline-offset-4 hover:underline"
                >
                  {artist.name}
                </Link>
              ) : (
                <p className="mt-1 text-muted-foreground">Unknown artist</p>
              )}
              <div className="mt-3 flex justify-center gap-2">
                <Badge>{formatPlays(album.play_count)}</Badge>
                {album.track_count > 0 && (
                  <Badge variant="secondary">
                    {album.track_count} {album.track_count === 1 ? 'track' : 'tracks'}
                  </Badge>
                )}
              </div>
              {album.tags?.length > 0 && (
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {album.tags.map(tag => (
                    <Badge key={tag} variant="outline" className="text-xs font-normal">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Wiki summary */}
          {album.wiki_summary && <SummarySection summary={album.wiki_summary} />}

          {/* Track listing */}
          {tracks.length > 0 && (
            <div>
              <h2 className="mb-3 text-lg font-semibold">Tracks</h2>
              <Card className="border-border/50 px-4 py-0">
                <CardContent className="p-0">
                  {tracks.map((track, i) => (
                    <div key={track.id}>
                      {i > 0 && <Separator />}
                      <TrackRow track={track} index={i} />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
