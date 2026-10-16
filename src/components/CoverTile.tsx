import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Cover } from './Cover'

/**
 * A sleeve with one line for the record and one for the artist (or year),
 * the shop's standard label. Numbers live a tap deeper, on the record page.
 */
export function CoverTile({
  title,
  subtitle,
  src,
  onClick,
  shape,
  className,
  badge,
}: {
  title: string
  subtitle?: string
  src?: string
  onClick: () => void
  shape?: 'square' | 'circle'
  className?: string
  /** small sticker in the sleeve's corner, e.g. a play time */
  badge?: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={subtitle ? `${title}, ${subtitle}` : title}
      className={cn('block min-w-0 text-left', className)}
    >
      <span className="relative block">
        <Cover name={title} src={src} shape={shape} />
        {badge}
      </span>
      <span
        className={cn(
          'mt-1.5 block truncate text-[0.78rem] font-semibold leading-tight text-ink',
          shape === 'circle' && 'text-center',
        )}
      >
        {title}
      </span>
      {subtitle && (
        <span className="block truncate text-[0.72rem] leading-tight text-ink-3">{subtitle}</span>
      )}
    </button>
  )
}

/** A heading over a strip of sleeves you swipe through. */
export function CoverRow({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mt-7">
      <div className="mb-2.5 flex items-baseline justify-between gap-3 px-4">
        <h2 className="text-[1.3rem]">{title}</h2>
        {action}
      </div>
      <div className="no-scrollbar flex snap-x gap-2.5 overflow-x-auto scroll-pl-4 px-4 pb-1">
        {children}
      </div>
    </section>
  )
}
