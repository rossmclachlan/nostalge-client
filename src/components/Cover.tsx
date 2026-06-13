import { useState } from 'react'
import { cn } from '@/lib/cn'
import { initials, swatchFor } from '@/lib/format'

interface CoverProps {
  name: string
  src?: string
  className?: string
  /** rounded square placeholder for albums, circle for artists */
  shape?: 'square' | 'circle'
}

/**
 * Album / artist artwork. Falls back to a generated initials block whose
 * colour is derived from the name string, so the grid never has holes.
 */
export function Cover({ name, src, className, shape = 'square' }: CoverProps) {
  const [broken, setBroken] = useState(false)
  const show = src && !broken
  const { bg, fg } = swatchFor(name)
  const round = shape === 'circle' ? 'rounded-full' : 'rounded-[2px]'

  return (
    <div
      className={cn(
        'relative aspect-square w-full overflow-hidden border-[1.5px] border-ink',
        round,
        className,
      )}
      style={show ? undefined : { backgroundColor: bg }}
    >
      {show ? (
        <img
          src={src}
          alt={name}
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full w-full place-items-center p-2">
          <span
            className="font-display leading-none"
            style={{ color: fg, fontSize: 'clamp(1.75rem, 11vw, 3.25rem)' }}
          >
            {initials(name)}
          </span>
        </div>
      )}
      {/* faint toner age over the art */}
      <span className="aged pointer-events-none absolute inset-0" />
    </div>
  )
}
