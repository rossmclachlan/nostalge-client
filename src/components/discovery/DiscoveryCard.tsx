import { useState } from 'react'
import type { DiscoveryCard as Card, CardAlbum } from '@/lib/discovery/engine'
import { cn } from '@/lib/cn'
import { Cover } from '../Cover'
import { InfoIcon } from '../icons'

/* Alternate the lens sticker between sun and lavender down the stream. */
const LENS_TONES = ['bg-sun', 'bg-lavender']

/**
 * One discovery lens in the Stream view. The art carries it: the lens name is
 * a small sticker, the story behind it waits behind the "why?" button, and the
 * play-count metric lives on the record page instead.
 *
 * A lone record gets the full width; several become a strip you flip through.
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
  const [why, setWhy] = useState(false)
  const single = card.albums.length === 1

  return (
    <section className="card-in" style={{ animationDelay: `${index * 70}ms` }}>
      <div className="mb-2.5 flex items-center gap-2">
        <h2 className={cn('lens min-w-0', LENS_TONES[index % LENS_TONES.length])}>
          {card.headline}
        </h2>
        <button
          onClick={() => setWhy((w) => !w)}
          aria-expanded={why}
          aria-label="Why these records"
          className={cn(
            'ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors',
            why ? 'bg-ink text-paper' : 'text-ink-3 active:bg-paper-3',
          )}
        >
          <InfoIcon className="h-[18px] w-[18px]" />
        </button>
      </div>
      {why && <p className="-mt-1 mb-3 text-sm leading-snug text-ink-2">{card.subheadline}</p>}

      {single ? (
        <Sleeve album={card.albums[0]} onOpen={onOpenAlbum} hero />
      ) : (
        /* Bleeds to the screen edge so the next sleeve peeks in, which is what
           says "keep scrolling". `scroll-pl-4` lines the first sleeve up with
           the page gutter when it snaps. */
        <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-pl-4 gap-2.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:scroll-pl-6 sm:px-6">
          {card.albums.map((album) => (
            <Sleeve
              key={album.id}
              album={album}
              onOpen={onOpenAlbum}
              className="w-[58%] max-w-[15rem] shrink-0 snap-start"
            />
          ))}
        </div>
      )}
    </section>
  )
}

function Sleeve({
  album,
  onOpen,
  hero,
  className,
}: {
  album: CardAlbum
  onOpen: (id: string) => void
  hero?: boolean
  className?: string
}) {
  return (
    <button
      onClick={() => onOpen(album.id)}
      className={cn('block w-full text-left', className)}
      aria-label={`${album.title} by ${album.artistName}`}
    >
      <Cover
        name={album.title}
        src={album.imageUrl}
        className={hero ? 'sleeve-lift rounded-[4px]' : undefined}
      />
      <p
        className={cn(
          'mt-2 truncate font-semibold leading-tight text-ink',
          hero ? 'text-[0.95rem]' : 'text-[0.8rem]',
        )}
      >
        {album.title}
      </p>
      <p
        className={cn(
          'truncate leading-tight text-ink-3',
          hero ? 'text-[0.85rem]' : 'text-[0.75rem]',
        )}
      >
        {album.artistName}
      </p>
    </button>
  )
}
