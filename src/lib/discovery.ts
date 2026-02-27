/**
 * Helper functions for the Discovery tab.
 * "Daily" selections are seeded by today's date so they stay
 * consistent throughout the day but change the next day.
 */

/** Returns a numeric seed from today's date, e.g. 20260227. */
export function getDailySeed(): number {
  const d = new Date()
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

/** Simple seeded pseudo-random number generator (0–1). */
export function seededRandom(seed: number): number {
  // Use a simple hash (mulberry32-style) for a single output.
  let t = (seed + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Shuffle an array deterministically using the given seed. */
export function seededShuffle<T>(array: T[], seed: number): T[] {
  const result = [...array]
  let currentSeed = seed
  for (let i = result.length - 1; i > 0; i--) {
    currentSeed = currentSeed * 16807 + 1
    const j = ((currentSeed >>> 0) % (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** Returns { month, day } for "On This Day" queries. */
export function getDateRangeForToday(): { month: number; day: number } {
  const d = new Date()
  return { month: d.getMonth() + 1, day: d.getDate() }
}

/** Format a play count for display, e.g. "1.2k plays" or "342 plays". */
export function formatPlayCount(count: number): string {
  if (count >= 1000000) {
    const value = count / 1000000
    return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}M plays`
  }
  if (count >= 1000) {
    const value = count / 1000
    return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}k plays`
  }
  return `${count} plays`
}
