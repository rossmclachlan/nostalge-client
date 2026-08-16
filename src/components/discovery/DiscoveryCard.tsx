import { CATEGORY_META, type DiscoveryCard as Card, type CardAlbum } from '@/lib/discovery/engine'
import { Cover } from '../Cover'

/* Rotate through paper tones + a subtle pinned-to-board tilt per card. */
const TONES = ['bg-paper', 'bg-paper-2', 'bg-paper-3']
const TILTS = ['-0.8deg', '0.7deg', '-0.5deg', '0.6deg']

/**
 * One discovery card. The artwork is the point: the sleeves get the space, the
 * words stay out of their way, and a card with several records becomes a
 * scrollable strip rather than a cramped grid.
 *
 * There is no call-to-action button — the covers are the affordance, and
 * tapping one opens the record.
 */
export function DiscoveryCard({
  card,
  index,
  onOpenAlbum,
}: {
  card: Card
  index: number
  onOpenAlbum: (id: string) => void
}) {
  const meta = CATEGORY_META[card.category]
  const tone = TONES[index % TONES.length]
  const tilt = TILTS[index % TILTS.length]
  const single = card.albums.length === 1

  return (
    <div className="card-in" style={{ animationDelay: `${index * 70}ms` }}>
      <article
        className={`flyer aged ${tone} p-4`}
        style={{ transform: `rotate(${tilt})` }}
      >
        {/* Category and the metric share one line — the metric used to be a
            block of its own and cost the artwork a chunk of height. */}
        <div className="mb-2 flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-ink"
            style={{ backgroundColor: meta.dot }}
          />
          <span className="label truncate text-ink-3">{meta.label}</span>
          {card.metric && (
            <span className="price-sticker ml-auto inline-flex shrink-0 items-baseline gap-1 leading-none">
              <span className="text-base">{card.metric.value}</span>
              <span className="label text-[0.5rem]">{card.metric.label}</span>
            </span>
          )}
        </div>

        <h2 className="stamp-title text-[1.9rem] leading-[0.85]">{card.headline}</h2>
        <p className="mt-1.5 text-sm leading-snug text-ink-2">{card.subheadline}</p>

        {single ? (
          /* One record: let the sleeve carry the card. */
          <Sleeve
            album={card.albums[0]}
            onOpen={onOpenAlbum}
            className="mt-4 w-[68%] max-w-[17rem]"
          />
        ) : (
          /* A crate you flip through. Bleeds to the card edges so the next
             sleeve peeks in — that peek is what says "keep scrolling".
             `scroll-pl-4` matters: without it the snapport starts at the
             padding edge, so the first sleeve snaps flush to the card border
             instead of lining up with the headline. */
          <div className="no-scrollbar -mx-4 mt-4 flex snap-x snap-mandatory scroll-pl-4 gap-3 overflow-x-auto px-4 pb-1">
            {card.albums.map((album) => (
              <Sleeve
                key={album.id}
                album={album}
                onOpen={onOpenAlbum}
                className="w-36 shrink-0 snap-start sm:w-44"
              />
            ))}
          </div>
        )}
      </article>
    </div>
  )
}

function Sleeve({
  album,
  onOpen,
  className,
}: {
  album: CardAlbum
  onOpen: (id: string) => void
  className?: string
}) {
  return (
    <button
      onClick={() => onOpen(album.id)}
      className={`block text-left ${className ?? ''}`}
      aria-label={`${album.title} — ${album.artistName}`}
      title={`${album.title} — ${album.artistName}`}
    >
      <div className="sleeve-blend">
        <Cover name={album.title} src={album.imageUrl} />
      </div>
      <p className="mt-1.5 truncate text-[0.7rem] font-semibold leading-tight text-ink">
        {album.title}
      </p>
      <p className="truncate text-[0.7rem] leading-tight text-ink-3">{album.artistName}</p>
    </button>
  )
}
