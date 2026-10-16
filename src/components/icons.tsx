/* Hand-set inline icons — kept simple and chunky to suit the zine look. */
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

const base = (props: P) => ({
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
})

export const CrateIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 7h18l-1.5 12.5a1 1 0 0 1-1 .9H5.5a1 1 0 0 1-1-.9L3 7Z" />
    <path d="M3 7l1.2-3.2a1 1 0 0 1 .94-.65h13.7a1 1 0 0 1 .94.65L21 7" />
    <path d="M9 11v4M15 11v4" />
  </svg>
)

export const CompassIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15.5 8.5 13 13l-4.5 2.5L11 11l4.5-2.5Z" />
  </svg>
)

export const TagIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 11.5V4a1 1 0 0 1 1-1h7.5a1 1 0 0 1 .7.3l8 8a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-8-8a1 1 0 0 1-.3-.7Z" />
    <circle cx="7.5" cy="7.5" r="1.4" fill="currentColor" stroke="none" />
  </svg>
)

export const ChartIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
)

export const SearchIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
)

export const BackIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M15 5 8 12l7 7" />
  </svg>
)

export const RefreshIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 12a9 9 0 1 1-2.6-6.3M21 4v5h-5" />
  </svg>
)

export const SunIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)

export const MoonIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
)

export const ClockIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </svg>
)

export const CopyIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="1.5" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </svg>
)

export const CheckIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12.5 10 17.5 19 6.5" />
  </svg>
)
