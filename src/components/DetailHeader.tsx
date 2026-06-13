import { BackIcon } from './icons'

/** Sticky back bar for full-screen detail views. */
export function DetailHeader({
  title,
  onBack,
}: {
  title: string
  onBack: () => void
}) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b-[1.5px] border-ink bg-paper-2 px-3 py-2.5">
      <button
        onClick={onBack}
        aria-label="Back"
        className="btn-press grid h-9 w-9 place-items-center"
      >
        <BackIcon className="h-5 w-5" />
      </button>
      <span className="label text-ink-2">{title}</span>
    </header>
  )
}
