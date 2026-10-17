import { cn } from '@/lib/cn'

/* The Homegrown seal (a scalloped sunburst, shared with Mise and Priorities),
   holding Nostalge's mark: a record with an indigo label. */
const SCALLOP = (() => {
  const pts: string[] = []
  for (let k = 0; k <= 96; k++) {
    const t = (k / 96) * Math.PI * 2
    const r = 44 + 4.2 * Math.cos(12 * t)
    pts.push(`${(50 + r * Math.cos(t)).toFixed(1)} ${(50 + r * Math.sin(t)).toFixed(1)}`)
  }
  return `M${pts.join(' L')}Z`
})()

export function Seal({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={cn('-rotate-6 shrink-0', className)}>
      <path d={SCALLOP} fill="var(--color-sun)" stroke="var(--color-ink)" strokeWidth="5" />
      <circle cx="50" cy="50" r="27" fill="var(--color-ink)" />
      <circle cx="50" cy="50" r="19" fill="none" stroke="#4a4f44" strokeWidth="2" />
      <circle cx="50" cy="50" r="10" fill="var(--color-indigo)" />
      <circle cx="50" cy="50" r="2.5" fill="var(--color-sun)" />
    </svg>
  )
}
