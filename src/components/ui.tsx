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
      {kicker && <p className="label text-ink-3 mb-1">{kicker}</p>}
      <h2 className="text-[1.6rem] sm:text-[2rem]">
        {title}
      </h2>
    </div>
  )
}

/** A soft pill used for tags / metadata. */
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
    paper: 'bg-paper-2 text-ink',
    red: 'bg-lavender text-ink',
    olive: 'bg-paper-2 text-ink',
    yellow: 'bg-sun text-ink',
  }
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded-full border-[1.5px] border-kraft px-3 py-1.5 text-[0.8rem] font-semibold leading-none',
        tones[tone],
        onClick && 'active:bg-paper-3',
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
 * A row of filter pills; the selected one becomes an indigo sticker.
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
    <div role="tablist" className={cn('flex gap-1.5', className)}>
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.id)}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-[0.8rem] font-semibold transition-colors',
              on
                ? 'border-2 border-ink bg-indigo text-paper-2 shadow-[2px_2px_0_0_var(--shadow-ink)]'
                : 'border-[1.5px] border-kraft bg-paper-2 text-ink active:bg-paper-3',
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
    <div className="flyer mx-auto mt-10 max-w-sm p-6 text-center">
      <h3 className="text-[1.75rem] text-ink">{title}</h3>
      <p className="mt-2 text-sm text-ink-2">{body}</p>
    </div>
  )
}
