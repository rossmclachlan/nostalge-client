/* Small presentation helpers shared across the UI. */

/** "1.2k" / "342" — compact play counts. */
export function formatPlays(count: number): string {
  if (!count || count < 0) return '0'
  if (count >= 1_000_000) {
    const v = count / 1_000_000
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}M`
  }
  if (count >= 1000) {
    const v = count / 1000
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}k`
  }
  return String(count)
}

/** Up to two initials from an artist / album name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '??'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/* A small riso-ish palette for generated placeholders. */
const SWATCHES = [
  { bg: '#c83f2b', fg: '#f1e7d0' }, // riso red
  { bg: '#5f6a2c', fg: '#f1e7d0' }, // olive
  { bg: '#edb22a', fg: '#1b1712' }, // yellow
  { bg: '#2f5d6b', fg: '#f1e7d0' }, // blue
  { bg: '#1b1712', fg: '#edb22a' }, // ink/yellow
  { bg: '#3a342b', fg: '#f1e7d0' }, // dark
]

/** Deterministic swatch derived from the name string. */
export function swatchFor(name: string): { bg: string; fg: string } {
  let h = 0
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0
  }
  return SWATCHES[h % SWATCHES.length]
}

/** "3 years ago" / "5 months ago" / "last week" from an ISO date. */
export function relativeAge(iso: string): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'never'
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`
  if (days < 365) return `${Math.floor(days / 30)} months ago`
  const years = Math.floor(days / 365)
  return years === 1 ? 'a year ago' : `${years} years ago`
}

/** Local clock time, e.g. "14:32". */
export function clockTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** A day heading: "Today" / "Yesterday" / "Mon 14 Jun". */
export function dayHeading(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Unknown'
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

/** Strip HTML tags down to a plain-text excerpt (for Last.fm bios). */
export function plainText(html: string, max = 240): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text
}
