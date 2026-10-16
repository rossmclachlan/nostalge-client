import { cn } from '@/lib/cn'
import { ClockIcon, CompassIcon, CrateIcon } from './icons'

/**
 * Three tabs, by intent rather than by data source:
 *
 *   Discover — be told what to play (generated cards)
 *   Library  — find something specific (Crates + Tags, two indexes into one shelf)
 *   History  — look back (Recent feed + Stats, the same facts at two zoom levels)
 *
 * Crates/Tags and Recent/Stats are chosen with a SegmentedControl inside their
 * tab; that selection lives in App so it survives drilling into a detail.
 */
export type Tab = 'discovery' | 'library' | 'history'

const ITEMS: { id: Tab; label: string; Icon: typeof CrateIcon }[] = [
  { id: 'discovery', label: 'Discover', Icon: CompassIcon },
  { id: 'library', label: 'Library', Icon: CrateIcon },
  { id: 'history', label: 'History', Icon: ClockIcon },
]

export function BottomNav({
  active,
  onChange,
}: {
  active: Tab
  onChange: (tab: Tab) => void
}) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t-[1.5px] border-kraft bg-paper-2"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto grid max-w-md grid-cols-3 sm:max-w-xl">
        {ITEMS.map(({ id, label, Icon }) => {
          const on = active === id
          return (
            <li key={id}>
              <button
                onClick={() => onChange(id)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'flex w-full flex-col items-center gap-1 pb-2 pt-2.5 text-[0.7rem] font-bold',
                  on ? 'text-ink' : 'text-ink-3',
                )}
              >
                {/* The active tab is a sticker pill. */}
                <span
                  className={cn(
                    'grid h-8 w-14 place-items-center rounded-full transition-colors',
                    on && 'border-2 border-ink bg-[var(--nav-active-bg)] shadow-[2px_2px_0_0_var(--shadow-ink)]',
                  )}
                >
                  <Icon className="h-[22px] w-[22px]" strokeWidth={on ? 2.2 : 1.8} />
                </span>
                {label}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
