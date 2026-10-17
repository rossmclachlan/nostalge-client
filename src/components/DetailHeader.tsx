import { BackIcon } from './icons'

/** Sticky back button for full-screen detail views. */
export function DetailHeader({
  title,
  onBack,
}: {
  title: string
  onBack: () => void
}) {
  return (
    <header
      className="sticky top-0 z-20 flex items-center gap-2 bg-paper/90 px-2 pb-1.5 backdrop-blur"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.375rem)' }}
    >
      <button
        onClick={onBack}
        aria-label="Back"
        className="grid h-11 w-11 place-items-center rounded-full text-ink active:bg-paper-3"
      >
        <BackIcon className="h-[22px] w-[22px]" />
      </button>
      <span className="label text-ink-3">{title}</span>
    </header>
  )
}
