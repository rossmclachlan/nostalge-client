import { useEffect, useMemo } from 'react'
import type { MusicData } from '@/lib/types'
import { buildContext, recordShown, selectCards } from '@/lib/discovery/engine'
import { GENERATORS } from '@/lib/discovery/cards'
import { DiscoveryCard } from './DiscoveryCard'
import { EmptyState } from '../ui'

export function DiscoveryTab({
  data,
  seed,
  onReroll,
  onOpenAlbum,
}: {
  data: MusicData
  /** Selection seed, owned by App so it persists across detail navigation. */
  seed: number
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
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="label text-ink-3">A few things worth putting on.</p>
        <button onClick={onReroll} className="btn-press px-3 py-1.5 text-xs">
          ↻ Shuffle
        </button>
      </div>

      {/* keyed by seed so a shuffle replays the entrance animation */}
      <div key={seed} className="space-y-5">
        {cards.map((card, i) => (
          <DiscoveryCard
            key={card.id}
            card={card}
            index={i}
            onOpenAlbum={onOpenAlbum}
          />
        ))}
      </div>
    </div>
  )
}
