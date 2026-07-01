import { CATEGORY_META, type DiscoveryCard as Card } from '@/lib/discovery/engine'
import { Cover } from '../Cover'

/* Rotate through paper tones + a subtle pinned-to-board tilt per card. */
const TONES = ['bg-paper', 'bg-paper-2', 'bg-paper-3']
const TILTS = ['-0.8deg', '0.7deg', '-0.5deg', '0.6deg']

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

  return (
    <div className="card-in" style={{ animationDelay: `${index * 70}ms` }}>
      <article
        className={`flyer aged ${tone} p-4`}
        style={{ transform: `rotate(${tilt})` }}
      >
        {/* Category label + coloured dot */}
        <div className="mb-2 flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full border border-ink"
            style={{ backgroundColor: meta.dot }}
          />
          <span className="label text-ink-3">{meta.label}</span>
        </div>

        <h2 className="stamp-title text-[2.1rem] leading-[0.85]">{card.headline}</h2>
        <p className="mt-1.5 text-sm leading-snug text-ink-2">{card.subheadline}</p>

        {card.metric && (
          <div className="mt-3">
            <span className="price-sticker inline-flex items-baseline gap-1.5">
              <span className="text-3xl leading-none">{card.metric.value}</span>
              <span className="label text-[0.6rem]">{card.metric.label}</span>
            </span>
          </div>
        )}

        {/* Sleeve thumbnails */}
        {card.albums.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {card.albums.map((album) => (
              <button
                key={album.id}
                onClick={() => onOpenAlbum(album.id)}
                className="w-14 shrink-0 sm:w-16"
                aria-label={`${album.title} — ${album.artistName}`}
                title={`${album.title} — ${album.artistName}`}
              >
                <div className="sleeve-blend">
                  <Cover name={album.title} src={album.imageUrl} />
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="mt-4">
          <button
            onClick={() => card.albums[0] && onOpenAlbum(card.albums[0].id)}
            className="btn-press bg-riso-yellow px-3 py-1.5 text-xs"
          >
            {card.cta} →
          </button>
        </div>
      </article>
    </div>
  )
}
