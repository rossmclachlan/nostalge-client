import { useMemo } from 'react'
import type { MusicData } from '@/lib/types'
import { sortedTags } from '@/lib/derive'
import { EmptyState } from '../ui'

/* Rotate divider colours so the index reads like a box of index cards. */
const EDGES = ['#c83f2b', '#5f6a2c', '#edb22a', '#2f5d6b', '#1b1712']

export function TagsTab({
  data,
  onOpenTag,
}: {
  data: MusicData
  onOpenTag: (id: string) => void
}) {
  const tags = useMemo(() => sortedTags(data), [data])

  if (tags.length === 0) {
    return (
      <EmptyState
        title="No dividers"
        body="Genres, moods and eras show up here once your collection has been tagged."
      />
    )
  }

  return (
    <div>
      <p className="label text-ink-3 mb-3">{tags.length} dividers</p>
      <ul className="space-y-2.5">
        {tags.map((tag, i) => (
          <li key={tag.id}>
            <button
              onClick={() => onOpenTag(tag.id)}
              className="divider-card flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              style={{ borderLeftColor: EDGES[i % EDGES.length] }}
            >
              <span
                className="font-display text-2xl leading-none text-ink uppercase tracking-wide"
                style={{ transform: `rotate(${(i % 3) - 1}deg)` }}
              >
                {tag.name}
              </span>
              {tag.usage_count > 0 && (
                <span className="label text-ink-3 shrink-0">{tag.usage_count}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
