import { cn } from '@/lib/cn'
import { ChartIcon, ClockIcon, CompassIcon, CrateIcon, TagIcon } from './icons'

export type Tab = 'crates' | 'discovery' | 'tags' | 'stats' | 'recent'

const ITEMS: { id: Tab; label: string; Icon: typeof CrateIcon }[] = [
  { id: 'discovery', label: 'Discover', Icon: CompassIcon },
  { id: 'crates', label: 'Crates', Icon: CrateIcon },
  { id: 'tags', label: 'Tags', Icon: TagIcon },
  { id: 'stats', label: 'Stats', Icon: ChartIcon },
  { id: 'recent', label: 'Recent', Icon: ClockIcon },
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
      <ul className="mx-auto grid max-w-md grid-cols-5 sm:max-w-xl">
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
