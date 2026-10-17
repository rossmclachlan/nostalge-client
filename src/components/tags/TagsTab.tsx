import { useMemo } from 'react'
import type { MusicData } from '@/lib/types'
import { sortedTags } from '@/lib/derive'
import { EmptyState } from '../ui'

/* Rotate divider colours so the index reads like a box of index cards. */
const EDGES = ['#3a3f9e', '#ffc83d', '#2f7a45', '#dcddf7', '#22261c']

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
      <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {tags.map((tag, i) => (
          <li key={tag.id}>
            <button
              onClick={() => onOpenTag(tag.id)}
              className="divider-card flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              style={{ borderLeftColor: EDGES[i % EDGES.length] }}
            >
              <span
                className="font-display text-xl italic font-semibold leading-tight text-ink"
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
