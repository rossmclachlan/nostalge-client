import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { ChevronIcon } from './icons'

/** A folded shelf: numbers and notes wait here, one tap deeper than the art. */
export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flyer mx-4 mt-7">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <span className="flex-1 text-[0.95rem] font-semibold text-ink">{title}</span>
        <ChevronIcon className={cn('h-[18px] w-[18px] text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t-[1.5px] border-kraft px-4 pb-4 pt-3">{children}</div>}
    </div>
  )
}
