import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Music, Users, Disc3 } from 'lucide-react'
import pb from '@/lib/pocketbase'
import type { Scrobble, Track, Artist, Album } from '@/types/pocketbase'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'

const PER_PAGE = 50

type ScrobbleExpanded = Scrobble & {
  expand?: {
    track?: Track & {
      expand?: {
        artist?: Artist
        album?: Album
      }
    }
  }
}

// --- Relative time formatting ---

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const seconds = Math.floor((now - then) / 1000)

  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function formatDayHeader(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

function dayKey(dateStr: string): string {
  return new Date(dateStr).toISOString().slice(0, 10)
}

// --- Skeleton loaders ---

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="border-border/50 py-4">
          <CardContent className="flex flex-col items-center gap-1 p-0 px-3">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-6 w-12" />
            <Skeleton className="h-3 w-16" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function ScrobbleListSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i}>
          {i > 0 && <Separator />}
          <div className="flex items-center gap-3 py-3">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      ))}
    </div>
  )
}

// --- Stat card ---

function StatCard({ icon: Icon, value, label }: {
  icon: React.ComponentType<{ className?: string }>
  value: number | null
  label: string
}) {
  return (
    <Card className="border-border/50 py-4">
      <CardContent className="flex flex-col items-center gap-1 p-0 px-3">
        <Icon className="h-4 w-4 text-primary" />
        {value !== null ? (
          <span className="text-xl font-bold">{value.toLocaleString()}</span>
        ) : (
          <Skeleton className="h-6 w-12" />
        )}
        <span className="text-xs text-muted-foreground">{label}</span>
      </CardContent>
    </Card>
  )
}

// --- Scrobble row ---

function ScrobbleRow({ scrobble }: { scrobble: ScrobbleExpanded }) {
  const track = scrobble.expand?.track
  const artist = track?.expand?.artist
  const album = track?.expand?.album
  const [imgError, setImgError] = useState(false)

  const content = (
    <div className="flex items-center gap-3 py-3">
      <Avatar className="h-10 w-10 rounded-lg">
        {album?.image_url && !imgError ? (
          <AvatarImage
            src={album.image_url}
            alt={album.title}
            className="rounded-lg"
            onError={() => setImgError(true)}
          />
        ) : (
          <AvatarFallback className="rounded-lg">
            <Disc3 className="h-4 w-4" />
          </AvatarFallback>
        )}
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{track?.title ?? 'Unknown track'}</p>
        <p className="truncate text-xs text-muted-foreground">{artist?.name ?? 'Unknown artist'}</p>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(scrobble.scrobbled_at)}</span>
    </div>
  )

  if (album) {
    return (
      <Link to={`/albums/${album.id}`} className="block transition-colors hover:bg-accent/50 -mx-2 px-2 rounded-md">
        {content}
      </Link>
    )
  }

  return content
}

// --- Main page ---

export default function ActivityPage() {
  const [scrobbles, setScrobbles] = useState<ScrobbleExpanded[]>([])
  const [page, setPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [totalScrobbles, setTotalScrobbles] = useState<number | null>(null)
  const [totalArtists, setTotalArtists] = useState<number | null>(null)
  const [totalAlbums, setTotalAlbums] = useState<number | null>(null)

  const sentinelRef = useRef<HTMLDivElement>(null)

  // Fetch stats
  useEffect(() => {
    async function fetchStats() {
      try {
        const [s, a, al] = await Promise.all([
          pb.collection('scrobbles').getList(1, 1, { requestKey: null }),
          pb.collection('artists').getList(1, 1, { requestKey: null }),
          pb.collection('albums').getList(1, 1, { requestKey: null }),
        ])
        setTotalScrobbles(s.totalItems)
        setTotalArtists(a.totalItems)
        setTotalAlbums(al.totalItems)
      } catch {
        // Non-critical — stats just won't show numbers
      }
    }
    fetchStats()
  }, [])

  // Fetch scrobbles
  useEffect(() => {
    let cancelled = false

    async function fetchScrobbles() {
      try {
        setLoading(true)
        setError(null)
        const result = await pb.collection('scrobbles').getList<ScrobbleExpanded>(1, PER_PAGE, {
          sort: '-scrobbled_at',
          expand: 'track,track.artist,track.album',
          requestKey: null,
        })
        if (!cancelled) {
          setScrobbles(result.items)
          setTotalItems(result.totalItems)
          setPage(1)
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          setError(`Failed to load activity: ${message}`)
          console.error(err)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchScrobbles()
    return () => { cancelled = true }
  }, [])

  const loadMore = useCallback(async () => {
    if (loadingMore) return
    const nextPage = page + 1
    setLoadingMore(true)
    try {
      const result = await pb.collection('scrobbles').getList<ScrobbleExpanded>(nextPage, PER_PAGE, {
        sort: '-scrobbled_at',
        expand: 'track,track.artist,track.album',
        requestKey: null,
      })
      setScrobbles(prev => [...prev, ...result.items])
      setPage(nextPage)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingMore(false)
    }
  }, [page, loadingMore])

  const hasMore = scrobbles.length < totalItems

  // Infinite scroll observer
  useEffect(() => {
    if (!hasMore || loading) return
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          loadMore()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loading, loadMore])

  // Group scrobbles by day
  const grouped = useMemo(() => {
    const groups: { key: string; label: string; items: ScrobbleExpanded[] }[] = []
    let currentKey = ''
    for (const scrobble of scrobbles) {
      const dk = dayKey(scrobble.scrobbled_at)
      if (dk !== currentKey) {
        currentKey = dk
        groups.push({ key: dk, label: formatDayHeader(scrobble.scrobbled_at), items: [] })
      }
      groups[groups.length - 1].items.push(scrobble)
    }
    return groups
  }, [scrobbles])

  return (
    <div className="p-4">
      <h1 className="mb-4 text-2xl font-bold">Activity</h1>

      {/* Stats summary */}
      {totalScrobbles === null && totalArtists === null && totalAlbums === null ? (
        <div className="mb-6">
          <StatsSkeleton />
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-3 gap-3">
          <StatCard icon={Music} value={totalScrobbles} label="Scrobbles" />
          <StatCard icon={Users} value={totalArtists} label="Artists" />
          <StatCard icon={Disc3} value={totalAlbums} label="Albums" />
        </div>
      )}

      {/* Scrobble feed */}
      {loading ? (
        <ScrobbleListSkeleton />
      ) : error ? (
        <p className="py-12 text-center text-destructive">{error}</p>
      ) : scrobbles.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">No scrobbles yet.</p>
      ) : (
        <div className="space-y-4">
          {grouped.map(group => (
            <div key={group.key}>
              <div className="flex items-center gap-3 py-2">
                <Separator className="flex-1" />
                <span className="shrink-0 text-xs font-medium text-muted-foreground">{group.label}</span>
                <Separator className="flex-1" />
              </div>
              <div>
                {group.items.map((scrobble, i) => (
                  <div key={scrobble.id}>
                    {i > 0 && <Separator className="ml-13" />}
                    <ScrobbleRow scrobble={scrobble} />
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Infinite scroll sentinel */}
          {hasMore && (
            <div ref={sentinelRef} className="flex justify-center py-4">
              {loadingMore && (
                <Button variant="ghost" disabled className="pointer-events-none">
                  Loading...
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
