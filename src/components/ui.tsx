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
        onClick && 'btn-press !shadow-[1.5px_1.5px_0_0_var(--color-ink)]',
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
