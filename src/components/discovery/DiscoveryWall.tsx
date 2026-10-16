import { useMemo, useRef, useState } from 'react'
import type { DiscoveryCard, CardAlbum } from '@/lib/discovery/engine'
import { cn } from '@/lib/cn'
import { Cover } from '../Cover'

/** Most sleeves a single lens adds to the wall, so no one lens floods it. */
const PER_LENS = 6
/** How long a press must last to peek at a sleeve's label. */
const PEEK_MS = 350

interface Tile {
  album: CardAlbum
  /** the lens name, on the first sleeve each lens contributes */
  lens?: string
  why?: string
  size: 'small' | 'big-left' | 'big-right'
}

/**
 * The Wall: every lens's records laid out as one mosaic of sleeves, with
 * almost no words. Each lens's first sleeve wears a small sticker naming it,
 * and every third lens opens on a big tile (alternating sides) so the wall has
 * rhythm. Titles appear on hover, or when you press and hold a sleeve; a tap
 * opens the record.
 */
export function DiscoveryWall({
  cards,
  onOpenAlbum,
}: {
  cards: DiscoveryCard[]
  onOpenAlbum: (id: string) => void
}) {
  const tiles = useMemo(() => {
    const seen = new Set<string>()
    const out: Tile[] = []
    let bigs = 0
    cards.forEach((card, ci) => {
      const fresh = card.albums.filter((a) => !seen.has(a.id)).slice(0, PER_LENS)
      fresh.forEach((album, i) => {
        seen.add(album.id)
        const first = i === 0
        const big = first && ci % 3 === 0
        out.push({
          album,
          lens: first ? card.headline : undefined,
          why: first ? card.subheadline : undefined,
          size: big ? (bigs++ % 2 === 0 ? 'big-left' : 'big-right') : 'small',
        })
      })
    })
    return out
  }, [cards])

  return (
    <div className="-mx-3 grid grid-flow-dense grid-cols-3 gap-1 sm:-mx-4 sm:grid-cols-4 lg:grid-cols-6">
      {tiles.map((t, i) => (
        <WallTile key={t.album.id} tile={t} index={i} onOpen={onOpenAlbum} />
      ))}
    </div>
  )
}

function WallTile({
  tile,
  index,
  onOpen,
}: {
  tile: Tile
  index: number
  onOpen: (id: string) => void
}) {
  const { album, lens, why, size } = tile
  const [peek, setPeek] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  // Set once a press turned into a peek, so letting go doesn't also open it.
  const peeked = useRef(false)

  const start = () => {
    peeked.current = false
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      peeked.current = true
      setPeek(true)
    }, PEEK_MS)
  }
  const end = () => {
    window.clearTimeout(timer.current)
    setPeek(false)
  }

  return (
    <button
      onClick={() => {
        if (!peeked.current) onOpen(album.id)
        peeked.current = false
      }}
      onPointerDown={start}
      onPointerUp={end}
      onPointerLeave={end}
      onPointerCancel={end}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`${album.title} by ${album.artistName}`}
      title={why}
      className={cn(
        'card-in group relative block aspect-square min-w-0 select-none [-webkit-touch-callout:none]',
        size !== 'small' && 'col-span-2 row-span-2',
        size === 'big-right' && 'col-start-2',
      )}
      style={{ animationDelay: `${Math.min(index, 18) * 30}ms` }}
    >
      <Cover name={album.title} src={album.imageUrl} className="h-full rounded-[2px]" />

      {lens && (
        <span
          className={cn(
            'lens pointer-events-none absolute left-1 top-1.5 max-w-[calc(100%-0.5rem)]',
            size === 'small' && 'px-2 text-[0.65rem]',
          )}
        >
          {lens}
        </span>
      )}

      <span
        className={cn(
          'pointer-events-none absolute inset-x-1.5 bottom-1.5 flex flex-col rounded-[10px] border-2 border-ink bg-paper-2 px-2 py-1 text-left opacity-0 shadow-[2px_2px_0_0_var(--shadow-ink)] transition-opacity',
          peek ? 'opacity-100' : '[@media(hover:hover)]:group-hover:opacity-100',
        )}
      >
        <span className="truncate text-[0.75rem] font-semibold leading-tight text-ink">
          {album.title}
        </span>
        <span className="truncate text-[0.7rem] leading-tight text-ink-3">
          {album.artistName}
        </span>
      </span>
    </button>
  )
}
