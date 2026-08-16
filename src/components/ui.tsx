import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { formatPlays } from '@/lib/format'

/** Big stamped section header with an optional kicker line. */
export function SectionHeader({
  kicker,
  title,
  className,
}: {
  kicker?: string
  title: string
  className?: string
}) {
  return (
    <div className={cn('mb-3', className)}>
      {kicker && <p className="label text-riso-red mb-1">{kicker}</p>}
      <h2 className="stamp-title text-[2rem] leading-[0.85] sm:text-[2.5rem]">
        {title}
      </h2>
    </div>
  )
}

/** A little tape-on chip used for tags / metadata. */
export function Chip({
  children,
  onClick,
  tone = 'paper',
  className,
}: {
  children: ReactNode
  onClick?: () => void
  tone?: 'paper' | 'red' | 'olive' | 'yellow'
  className?: string
}) {
  const tones = {
    paper: 'bg-paper text-ink',
    red: 'bg-riso-red text-paper',
    olive: 'bg-riso-olive text-paper',
    yellow: 'bg-riso-yellow text-ink',
  }
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      onClick={onClick}
      className={cn(
        'label inline-flex items-center border-[1.5px] border-ink px-2 py-[3px] leading-none',
        tones[tone],
        onClick && 'btn-press !shadow-[1.5px_1.5px_0_0_var(--shadow-ink)]',
        className,
      )}
    >
      {children}
    </Tag>
  )
}

/** Hand-written price-sticker style play count. */
export function PlayBadge({ count, label = 'plays' }: { count: number; label?: string }) {
  return (
    <span className="price-sticker inline-flex items-baseline gap-1 text-sm leading-none">
      <span className="text-base">{formatPlays(count)}</span>
      <span className="label text-[0.55rem]">{label}</span>
    </span>
  )
}

/**
 * Switches between the views inside a grouped tab (Crates/Tags, Recent/Stats).
 *
 * Deliberately not a third row of navigation: it reads as one pinned label
 * strip, and the selected half is filled the same way the bottom nav fills its
 * active tab.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex border-[1.5px] border-ink shadow-[2px_2px_0_0_var(--shadow-ink)]',
        className,
      )}
    >
      {options.map((o, i) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.id)}
            className={cn(
              'label px-3 py-1.5 leading-none transition-colors',
              i > 0 && 'border-l-[1.5px] border-ink',
              on ? 'bg-ink text-paper' : 'text-ink-2 active:bg-paper-3',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function EmptyState({
  title,
  body,
}: {
  title: string
  body: string
}) {
  return (
    <div className="flyer aged tilt-l mx-auto mt-10 max-w-sm p-6 text-center">
      <h3 className="stamp-title text-[2.25rem] text-ink">{title}</h3>
      <p className="mt-2 text-sm text-ink-2">{body}</p>
    </div>
  )
}
