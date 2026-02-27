import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import {
  Calendar,
  Tag as TagIcon,
  Disc3,
  Heart,
  Shuffle,
  Copy,
  Check,
} from 'lucide-react'
import pb from '@/lib/pocketbase'
import type { Album, Artist, Tag, Track, Scrobble } from '@/types/pocketbase'
import { getDailySeed, seededShuffle, seededRandom } from '@/lib/discovery'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

type AlbumWithArtist = Album & {
  expand?: { artist?: Artist; tag_relations?: Tag[] }
}
type ScrobbleExpanded = Scrobble & {
  expand?: {
    track?: Track & {
      expand?: { artist?: Artist; album?: Album }
    }
  }
}

/* ── Shared helpers ── */

function formatPlays(count: number): string {
  return count.toLocaleString() + ' plays'
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0] ?? '')
    .join('')
    .toUpperCase()
}

function getGradientForName(name: string): string {
  let hash = 0
  for (const ch of name) hash = ch.charCodeAt(0) + ((hash << 5) - hash)
  const hue1 = Math.abs(hash % 360)
  const hue2 = (hue1 + 40) % 360
  return `linear-gradient(135deg, hsl(${hue1}, 50%, 30%), hsl(${hue2}, 50%, 20%))`
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

const SCROLL_ROW =
  'flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

function ScrollRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="relative">
      <div className={SCROLL_ROW + (className ? ' ' + className : '')}>
        {children}
      </div>
      <div className="pointer-events-none absolute bottom-2 right-0 top-0 w-8 bg-gradient-to-r from-transparent to-background" />
    </div>
  )
}

function EmptyState({
  icon: Icon,
  message,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  message: string
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/50 py-8">
      <Icon className="mb-2 h-8 w-8 text-muted-foreground/40" strokeWidth={1.5} />
      <p className="max-w-xs text-center text-sm text-muted-foreground">
        {message}
      </p>
    </div>
  )
}

/* ── Mini cards for horizontal scroll rows ── */

function MiniAlbumCard({
  album,
  showCopy,
}: {
  album: AlbumWithArtist
  showCopy?: boolean
}) {
  const [imgError, setImgError] = useState(false)
  const artist = album.expand?.artist
  const copyText = `${artist?.name ?? 'Unknown artist'} - ${album.title}`

  return (
    <div className="w-40 shrink-0">
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
                <Disc3 className="h-8 w-8" strokeWidth={1.5} />
              </div>
            )}
          </div>
        </Link>
        {showCopy && <CopyButton text={copyText} />}
        <div className="p-2.5">
          <Link to={`/albums/${album.id}`}>
            <h3 className="truncate text-sm font-semibold text-card-foreground">
              {album.title}
            </h3>
          </Link>
          {artist ? (
            <Link
              to={`/artists/${artist.id}`}
              className="mt-0.5 block truncate text-xs text-muted-foreground transition-colors hover:text-primary"
            >
              {artist.name}
            </Link>
          ) : (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Unknown artist
            </p>
          )}
          <Badge variant="secondary" className="mt-1 text-xs font-normal">
            {formatPlays(album.play_count)}
          </Badge>
        </div>
      </Card>
    </div>
  )
}

function MiniArtistCard({ artist }: { artist: Artist }) {
  const navigate = useNavigate()
  const [imgError, setImgError] = useState(false)

  return (
    <div className="w-36 shrink-0">
      <Card
        className="group cursor-pointer overflow-hidden border-border/50 p-0 transition-colors hover:border-primary/40 hover:bg-accent"
        onClick={() => navigate(`/artists/${artist.id}`)}
      >
        <div className="aspect-square overflow-hidden bg-accent">
          {artist.image_url && !imgError ? (
            <img
              src={artist.image_url}
              alt={artist.name}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
              onError={() => setImgError(true)}
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center text-xl font-bold text-white/80"
              style={{ background: getGradientForName(artist.name) }}
            >
              {getInitials(artist.name)}
            </div>
          )}
        </div>
        <div className="p-2.5">
          <h3 className="truncate text-sm font-semibold text-card-foreground">
            {artist.name}
          </h3>
          <Badge variant="secondary" className="mt-1 text-xs font-normal">
            {formatPlays(artist.play_count)}
          </Badge>
        </div>
      </Card>
    </div>
  )
}

/* ── Section: On This Day (albums) ── */

type OnThisDayAlbum = {
  id: string
  title: string
  image_url?: string
  artistName: string
  artistId?: string
}

function OnThisDaySection() {
  const [groups, setGroups] = useState<
    { year: number; albums: OnThisDayAlbum[] }[]
  >([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const now = new Date()
        const month = now.getMonth() + 1
        const day = now.getDate()
        const currentYear = now.getFullYear()

        // Build date-range filters for the same calendar date in each previous year
        const yearFilters: string[] = []
        for (let y = currentYear - 1; y >= currentYear - 10; y--) {
          const dateStr = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const nextDate = new Date(y, month - 1, day + 1)
          const nextStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`
          yearFilters.push(
            `(scrobbled_at >= "${dateStr} 00:00:00" && scrobbled_at < "${nextStr} 00:00:00")`,
          )
        }

        const filter = yearFilters.join(' || ')
        // Use getList instead of getFullList to avoid the implicit skipTotal: true
        // that getFullList sets internally, which causes totalItems to be 0.
        const result = await pb
          .collection('scrobbles')
          .getList<ScrobbleExpanded>(1, 500, {
            filter,
            sort: '-scrobbled_at',
            expand: 'track,track.artist,track.album',
            requestKey: null,
          })

        if (cancelled) return

        // Group scrobbles by year, counting per year
        const byYear = new Map<number, ScrobbleExpanded[]>()
        for (const s of result.items) {
          const year = new Date(s.scrobbled_at).getFullYear()
          if (!byYear.has(year)) byYear.set(year, [])
          byYear.get(year)!.push(s)
        }

        // Pick the 2-3 years with the most scrobbles
        const sortedYears = Array.from(byYear.entries())
          .sort((a, b) => b[1].length - a[1].length)
          .slice(0, 3)
          .sort((a, b) => b[0] - a[0]) // then order by year descending for display

        // For each year, group scrobbles by album and deduplicate
        const yearGroups = sortedYears.map(([year, scrobbles]) => {
          const seen = new Set<string>()
          const albums: OnThisDayAlbum[] = []
          for (const s of scrobbles) {
            const track = s.expand?.track
            const album = track?.expand?.album
            if (!album || seen.has(album.id)) continue
            seen.add(album.id)
            const artist = track?.expand?.artist
            albums.push({
              id: album.id,
              title: album.title,
              image_url: album.image_url,
              artistName: artist?.name ?? 'Unknown artist',
              artistId: artist?.id,
            })
          }
          return { year, albums }
        }).filter(g => g.albums.length > 0)

        setGroups(yearGroups)
      } catch (err) {
        console.error('On This Day fetch failed:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">On This Day</h2>
        </div>
        <ScrollRow>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="w-40 shrink-0">
              <Card className="gap-0 overflow-hidden border-border/50 p-0">
                <Skeleton className="aspect-square w-full rounded-none" />
                <div className="space-y-2 p-2.5">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </Card>
            </div>
          ))}
        </ScrollRow>
      </section>
    )
  }

  return (
    <section className="section-fade-in mb-8">
      <div className="mb-3 flex items-center gap-2">
        <Calendar className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">On This Day</h2>
      </div>
      {groups.length === 0 ? (
        <EmptyState
          icon={Calendar}
          message="No scrobbles on this date in previous years. This section fills up as your listening history grows!"
        />
      ) : (
        groups.map(({ year, albums }) => (
          <div key={year} className="mb-4">
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">
              {year}
            </h3>
            <ScrollRow>
              {albums.map(album => (
                <OnThisDayAlbumCard key={album.id} album={album} />
              ))}
            </ScrollRow>
          </div>
        ))
      )}
    </section>
  )
}

function OnThisDayAlbumCard({ album }: { album: OnThisDayAlbum }) {
  const [imgError, setImgError] = useState(false)

  return (
    <div className="w-40 shrink-0">
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
                <Disc3 className="h-8 w-8" strokeWidth={1.5} />
              </div>
            )}
          </div>
        </Link>
        <div className="p-2.5">
          <Link to={`/albums/${album.id}`}>
            <h3 className="truncate text-sm font-semibold text-card-foreground">
              {album.title}
            </h3>
          </Link>
          {album.artistId ? (
            <Link
              to={`/artists/${album.artistId}`}
              className="mt-0.5 block truncate text-xs text-muted-foreground transition-colors hover:text-primary"
            >
              {album.artistName}
            </Link>
          ) : (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {album.artistName}
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}

/* ── Section: Genre Dive ── */

function GenreDiveSection() {
  const [tag, setTag] = useState<Tag | null>(null)
  const [artists, setArtists] = useState<Artist[]>([])
  const [albums, setAlbums] = useState<AlbumWithArtist[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const tagsResult = await pb.collection('tags').getList<Tag>(1, 50, {
          sort: '-usage_count',
          requestKey: null,
        })

        if (cancelled || tagsResult.items.length === 0) {
          if (!cancelled) setLoading(false)
          return
        }

        // Pick a tag deterministically for the day
        const seed = getDailySeed()
        const idx = Math.floor(seededRandom(seed + 1) * tagsResult.items.length)
        const chosenTag = tagsResult.items[idx]
        setTag(chosenTag)

        const [artistsResult, albumsResult] = await Promise.all([
          pb.collection('artists').getList<Artist>(1, 15, {
            filter: `tag_relations~"${chosenTag.id}"`,
            sort: '-play_count',
            requestKey: null,
          }),
          pb.collection('albums').getList<AlbumWithArtist>(1, 15, {
            filter: `tag_relations~"${chosenTag.id}"`,
            sort: '-play_count',
            expand: 'artist',
            requestKey: null,
          }),
        ])

        if (!cancelled) {
          setArtists(artistsResult.items)
          setAlbums(albumsResult.items)
        }
      } catch (err) {
        console.error('Genre Dive fetch failed:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <TagIcon className="h-5 w-5 text-primary" />
          <Skeleton className="h-6 w-48" />
        </div>
        <Skeleton className="mb-2 h-4 w-16" />
        <ScrollRow>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-36 shrink-0">
              <Skeleton className="aspect-square w-full rounded-lg" />
              <Skeleton className="mt-2 h-3 w-3/4" />
              <Skeleton className="mt-1 h-3 w-12" />
            </div>
          ))}
        </ScrollRow>
      </section>
    )
  }

  if (!tag) {
    return (
      <section className="section-fade-in mb-8">
        <div className="mb-3 flex items-center gap-2">
          <TagIcon className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Today&apos;s Genre</h2>
        </div>
        <EmptyState
          icon={TagIcon}
          message="No genre tags found yet. Tags appear as your library grows."
        />
      </section>
    )
  }

  return (
    <section className="section-fade-in mb-8">
      <div className="mb-3 flex items-center gap-2">
        <TagIcon className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Today&apos;s Genre:</h2>
        <Link to={`/tags/${tag.id}`}>
          <Badge className="cursor-pointer">{tag.name}</Badge>
        </Link>
      </div>

      {artists.length > 0 && (
        <>
          <p className="mb-2 text-sm text-muted-foreground">Artists</p>
          <ScrollRow className="mb-4">
            {artists.map(artist => (
              <MiniArtistCard key={artist.id} artist={artist} />
            ))}
          </ScrollRow>
        </>
      )}

      {albums.length > 0 && (
        <>
          <p className="mb-2 text-sm text-muted-foreground">Albums</p>
          <ScrollRow>
            {albums.map(album => (
              <MiniAlbumCard key={album.id} album={album} />
            ))}
          </ScrollRow>
        </>
      )}
    </section>
  )
}

/* ── Section: Deep Cuts ── */

function DeepCutsSection() {
  const [albums, setAlbums] = useState<AlbumWithArtist[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const result = await pb
          .collection('albums')
          .getList<AlbumWithArtist>(1, 200, {
            sort: '-play_count',
            expand: 'artist',
            requestKey: null,
          })

        if (cancelled) return

        const items = result.items
        // Middle tier: skip top 20 %, take the next 60 %
        const start = Math.floor(items.length * 0.2)
        const end = Math.floor(items.length * 0.8)
        const middleTier = items.slice(start, end)

        const seed = getDailySeed()
        const shuffled = seededShuffle(middleTier, seed + 2)
        setAlbums(shuffled.slice(0, 15))
      } catch (err) {
        console.error('Deep Cuts fetch failed:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <section className="mb-8">
        <div className="mb-1 flex items-center gap-2">
          <Disc3 className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Deep Cuts</h2>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Albums you liked but might have forgotten
        </p>
        <ScrollRow>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-40 shrink-0">
              <Card className="gap-0 overflow-hidden border-border/50 p-0">
                <Skeleton className="aspect-square w-full rounded-none" />
                <div className="space-y-2 p-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-5 w-16" />
                </div>
              </Card>
            </div>
          ))}
        </ScrollRow>
      </section>
    )
  }

  if (albums.length === 0) {
    return (
      <section className="section-fade-in mb-8">
        <div className="mb-1 flex items-center gap-2">
          <Disc3 className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Deep Cuts</h2>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Albums you liked but might have forgotten
        </p>
        <EmptyState
          icon={Disc3}
          message="Not enough albums in your library yet to surface deep cuts."
        />
      </section>
    )
  }

  return (
    <section className="section-fade-in mb-8">
      <div className="mb-1 flex items-center gap-2">
        <Disc3 className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Deep Cuts</h2>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        Albums you liked but might have forgotten
      </p>
      <ScrollRow>
        {albums.map(album => (
          <MiniAlbumCard key={album.id} album={album} showCopy />
        ))}
      </ScrollRow>
    </section>
  )
}

/* ── Section: Forgotten Favorites ── */

function ForgottenFavoritesSection() {
  const [artists, setArtists] = useState<Artist[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const result = await pb
          .collection('artists')
          .getList<Artist>(1, 200, {
            sort: '-play_count',
            requestKey: null,
          })

        if (cancelled) return

        const items = result.items
        const start = Math.floor(items.length * 0.2)
        const end = Math.floor(items.length * 0.8)
        const middleTier = items.slice(start, end)

        const seed = getDailySeed()
        const shuffled = seededShuffle(middleTier, seed + 3)
        setArtists(shuffled.slice(0, 15))
      } catch (err) {
        console.error('Forgotten Favorites fetch failed:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <section className="mb-8">
        <div className="mb-1 flex items-center gap-2">
          <Heart className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Forgotten Favorites</h2>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Artists you haven&apos;t played lately
        </p>
        <ScrollRow>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-36 shrink-0">
              <Skeleton className="aspect-square w-full rounded-lg" />
              <Skeleton className="mt-2 h-4 w-3/4" />
              <Skeleton className="mt-1 h-3 w-12" />
            </div>
          ))}
        </ScrollRow>
      </section>
    )
  }

  if (artists.length === 0) {
    return (
      <section className="section-fade-in mb-8">
        <div className="mb-1 flex items-center gap-2">
          <Heart className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Forgotten Favorites</h2>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Artists you haven&apos;t played lately
        </p>
        <EmptyState
          icon={Heart}
          message="Keep scrobbling! We'll surface artists you haven't played in a while."
        />
      </section>
    )
  }

  return (
    <section className="section-fade-in mb-8">
      <div className="mb-1 flex items-center gap-2">
        <Heart className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Forgotten Favorites</h2>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        Artists you haven&apos;t played lately
      </p>
      <ScrollRow>
        {artists.map(artist => (
          <MiniArtistCard key={artist.id} artist={artist} />
        ))}
      </ScrollRow>
    </section>
  )
}

/* ── Section: Featured Albums (was "Spin the Wheel") ── */

function FeaturedAlbumCard({ album }: { album: AlbumWithArtist }) {
  const [imgError, setImgError] = useState(false)
  const artist = album.expand?.artist
  const copyText = `${artist?.name ?? 'Unknown artist'} - ${album.title}`

  return (
    <div className="w-[200px] shrink-0 md:w-[250px]">
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
                <Disc3 className="h-10 w-10" strokeWidth={1.5} />
              </div>
            )}
          </div>
        </Link>
        <CopyButton text={copyText} />
        <div className="p-3">
          <Link to={`/albums/${album.id}`}>
            <h3 className="truncate text-sm font-semibold text-card-foreground">
              {album.title}
            </h3>
          </Link>
          {artist ? (
            <Link
              to={`/artists/${artist.id}`}
              className="mt-0.5 block truncate text-xs text-muted-foreground transition-colors hover:text-primary"
            >
              {artist.name}
            </Link>
          ) : (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Unknown artist
            </p>
          )}
          <Badge variant="secondary" className="mt-1.5 text-xs font-normal">
            {formatPlays(album.play_count)}
          </Badge>
        </div>
      </Card>
    </div>
  )
}

function FeaturedAlbumsSection() {
  const [albums, setAlbums] = useState<AlbumWithArtist[]>([])
  const [pool, setPool] = useState<AlbumWithArtist[]>([])
  const [loading, setLoading] = useState(true)

  const selectFromPool = useCallback((items: AlbumWithArtist[], seed: number) => {
    const shuffled = seededShuffle(items, seed)
    setAlbums(shuffled.slice(0, Math.min(10, Math.max(5, shuffled.length))))
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const result = await pb
          .collection('albums')
          .getFullList<AlbumWithArtist>({
            filter: 'play_count >= 30',
            sort: '-play_count',
            expand: 'artist',
            requestKey: null,
          })

        if (cancelled) return

        setPool(result)
        selectFromPool(result, getDailySeed() + 4)
      } catch (err) {
        console.error('Featured Albums fetch failed:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [selectFromPool])

  function handleShuffle() {
    selectFromPool(pool, Math.floor(Math.random() * 1000000))
  }

  if (loading) {
    return (
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <Shuffle className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Featured Albums</h2>
        </div>
        <ScrollRow>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-[200px] shrink-0 md:w-[250px]">
              <Card className="gap-0 overflow-hidden border-border/50 p-0">
                <Skeleton className="aspect-square w-full rounded-none" />
                <div className="space-y-2 p-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-5 w-16" />
                </div>
              </Card>
            </div>
          ))}
        </ScrollRow>
      </section>
    )
  }

  if (albums.length === 0) {
    return (
      <section className="section-fade-in mb-8">
        <div className="mb-3 flex items-center gap-2">
          <Shuffle className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Featured Albums</h2>
        </div>
        <EmptyState
          icon={Shuffle}
          message="No albums with enough plays yet. Keep listening!"
        />
      </section>
    )
  }

  return (
    <section className="section-fade-in mb-8">
      <div className="mb-3 flex items-center gap-2">
        <Shuffle className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Featured Albums</h2>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-8 w-8"
          onClick={handleShuffle}
        >
          <Shuffle className="h-4 w-4" />
        </Button>
      </div>
      <ScrollRow>
        {albums.map(album => (
          <FeaturedAlbumCard key={album.id} album={album} />
        ))}
      </ScrollRow>
    </section>
  )
}

/* ── Main page ── */

function formatTodayHeader(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

export default function DiscoverPage() {
  const location = useLocation()

  return (
    <div className="p-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Daily Discovery</h1>
        <p className="text-muted-foreground">{formatTodayHeader()}</p>
      </div>

      <FeaturedAlbumsSection key={'fa-' + location.key} />
      <OnThisDaySection key={'otd-' + location.key} />
      <GenreDiveSection key={'gd-' + location.key} />
      <DeepCutsSection key={'dc-' + location.key} />
      <ForgottenFavoritesSection key={'ff-' + location.key} />
    </div>
  )
}
