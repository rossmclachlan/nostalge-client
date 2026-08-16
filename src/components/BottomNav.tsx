import { cn } from '@/lib/cn'
import { ClockIcon, CompassIcon, CrateIcon, ListIcon } from './icons'

/**
 * Four tabs, by intent rather than by data source:
 *
 *   Discover — be told what to play (generated cards)
 *   Library  — find something specific (Crates + Tags, two indexes into one shelf)
 *   Sets     — ask for a playlist in words
 *   History  — look back (Recent feed + Stats, the same facts at two zoom levels)
 *
 * Crates/Tags and Recent/Stats are chosen with a SegmentedControl inside their
 * tab; that selection lives in App so it survives drilling into a detail.
 */
export type Tab = 'discovery' | 'library' | 'playlists' | 'history'

const ITEMS: { id: Tab; label: string; Icon: typeof CrateIcon }[] = [
  { id: 'discovery', label: 'Discover', Icon: CompassIcon },
  { id: 'library', label: 'Library', Icon: CrateIcon },
  { id: 'playlists', label: 'Sets', Icon: ListIcon },
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
      className="fixed inset-x-0 bottom-0 z-30 border-t-[1.5px] border-ink bg-paper-2"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto grid max-w-md grid-cols-4 sm:max-w-xl">
        {ITEMS.map(({ id, label, Icon }) => {
          const on = active === id
          return (
            <li key={id}>
              <button
                onClick={() => onChange(id)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'flex w-full flex-col items-center gap-1 py-2.5 transition-colors',
                  on
                    ? 'bg-[var(--nav-active-bg)] text-riso-yellow'
                    : 'text-ink-2 active:bg-paper-3',
                )}
              >
                <Icon className="h-[22px] w-[22px]" strokeWidth={on ? 2.4 : 1.8} />
                <span className="label text-[0.6rem]">{label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
