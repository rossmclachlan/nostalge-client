import { useEffect, useMemo } from 'react'
import type { MusicData } from '@/lib/types'
import { buildContext, recordShown, selectCards } from '@/lib/discovery/engine'
import { GENERATORS } from '@/lib/discovery/cards'
import { DiscoveryCard } from './DiscoveryCard'
import { DiscoveryWall } from './DiscoveryWall'
import { EmptyState } from '../ui'
import { ShuffleIcon } from '../icons'

/** Wall: a mosaic of sleeves, labels on press. Stream: one lens at a time. */
export type DiscoveryView = 'wall' | 'stream'

export function DiscoveryTab({
  data,
  seed,
  view,
  onReroll,
  onOpenAlbum,
}: {
  data: MusicData
  /** Selection seed, owned by App so it persists across detail navigation. */
  seed: number
  view: DiscoveryView
  onReroll: () => void
  onOpenAlbum: (id: string) => void
}) {
  const cards = useMemo(() => {
    const ctx = buildContext(data, Date.now(), seed)
    return selectCards(GENERATORS, ctx, seed, 20)
  }, [data, seed])

  // Remember what we showed so the next shuffle can favour fresh cards.
  useEffect(() => {
    if (cards.length > 0) recordShown(cards.map((c) => c.id), Date.now())
  }, [cards])

  // Fewer than 3 cards with data → a single "come back later" invite.
  if (cards.length < 3) {
    return (
      <EmptyState
        title="Come back soon"
        body="There isn't enough listening history yet to dig up something interesting. Play a few more records and the discovery cards will start to appear."
      />
    )
  }

  return (
    <div>
      {/* keyed by seed so a shuffle replays the entrance animation */}
      {view === 'wall' ? (
        <DiscoveryWall key={seed} cards={cards} onOpenAlbum={onOpenAlbum} />
      ) : (
        <div key={seed} className="mx-auto max-w-xl space-y-9">
          {cards.map((card, i) => (
            <DiscoveryCard key={card.id} card={card} index={i} onOpenAlbum={onOpenAlbum} />
          ))}
        </div>
      )}

      <button
        onClick={onReroll}
        aria-label="Dig again: shuffle the selection"
        title="Dig again"
        className="sticker pebble fixed right-4 z-20 grid h-[60px] w-[60px] place-items-center bg-sun text-ink"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5.75rem)' }}
      >
        <ShuffleIcon className="h-[26px] w-[26px]" strokeWidth={2.4} />
      </button>
    </div>
  )
}
