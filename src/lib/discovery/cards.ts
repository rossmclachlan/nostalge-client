import type { Album, Artist } from '../types'
import { formatPlays, plainText } from '../format'
import type { CardGenerator, DiscoveryCard, EngineCtx } from './engine'

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

const DAY = 86_400_000
const YEAR = 365 * DAY
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const pct = (n: number) => Math.round(n * 100)
const hourOf = (ms: number) => new Date(ms).getHours()
const dayOf = (ms: number) => new Date(ms).getDay() // 0 = Sun … 6 = Sat

/** Pick the album that maximises `score`, among those `score` returns > 0 for. */
function bestAlbum(
  ctx: EngineCtx,
  score: (a: Album, plays: number[]) => number,
): { album: Album; plays: number[]; value: number } | null {
  let best: { album: Album; plays: number[]; value: number } | null = null
  for (const a of ctx.albums) {
    const plays = ctx.albumPlays.get(a.id) ?? []
    const v = score(a, plays)
    if (v > 0 && (!best || v > best.value)) best = { album: a, plays, value: v }
  }
  return best
}

/** Fraction of plays whose timestamp satisfies `pred`. */
function fraction(plays: number[], pred: (ms: number) => boolean): number {
  if (plays.length === 0) return 0
  let n = 0
  for (const t of plays) if (pred(t)) n++
  return n / plays.length
}

/** Albums grouped by (lowercased) tag name. */
function albumsByTag(ctx: EngineCtx): Map<string, Album[]> {
  const byTag = new Map<string, Album[]>()
  for (const a of ctx.albums) {
    if (!Array.isArray(a.tags)) continue
    for (const raw of a.tags) {
      const tag = String(raw).trim().toLowerCase()
      if (!tag) continue
      const arr = byTag.get(tag)
      if (arr) arr.push(a)
      else byTag.set(tag, [a])
    }
  }
  return byTag
}

/** Seeded pick of up to `n` distinct items. */
function pickDistinct<T>(arr: T[], n: number, rand: () => number): T[] {
  const pool = [...arr]
  const out: T[] = []
  while (out.length < n && pool.length > 0) {
    out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0])
  }
  return out
}

/** "indie pop" → "Indie Pop"; short tags like "idm" read as acronyms → "IDM". */
const titleCase = (s: string) =>
  s.length <= 3 ? s.toUpperCase() : s.replace(/\b[a-z]/g, (c) => c.toUpperCase())

/** Last.fm year tags ("2013") — treated as release years, not genres. */
const YEAR_TAG = /^(19|20)\d{2}$/

const byPlays = (a: Album, b: Album) => (b.play_count || 0) - (a.play_count || 0)

/* ================================================================== */
/*  TEMPORAL                                                          */
/* ================================================================== */

const onThisDay: CardGenerator = (ctx) => {
  const today = new Date(ctx.now)
  const m = today.getMonth()
  const d = today.getDate()
  const yr = today.getFullYear()

  const hits: { album: Album; oldest: number }[] = []
  for (const a of ctx.albums) {
    const plays = ctx.albumPlays.get(a.id) ?? []
    let oldest = 0
    for (const t of plays) {
      const dt = new Date(t)
      if (dt.getMonth() === m && dt.getDate() === d && dt.getFullYear() < yr) {
        if (!oldest || t < oldest) oldest = t
      }
    }
    if (oldest) hits.push({ album: a, oldest })
  }
  if (hits.length === 0) return null

  hits.sort((a, b) => a.oldest - b.oldest) // oldest first for the flashback feel
  const yearsAgo = Math.max(1, Math.round((ctx.now - hits[0].oldest) / YEAR))

  return {
    id: 'on-this-day',
    category: 'temporal',
    headline: 'On This Day',
    subheadline: `What you had on rotation this date in years gone by.`,
    metric: { value: String(yearsAgo), label: yearsAgo === 1 ? 'year ago' : 'years ago' },
    albums: hits.slice(0, 6).map((h) => ctx.toCardAlbum(h.album)),
    cta: 'Put it on again',
    narrativeScore: 0.95,
  }
}

const thisMonthThatYear: CardGenerator = (ctx) => {
  const m = new Date(ctx.now).getMonth()
  const thisYear = new Date(ctx.now).getFullYear()

  let best: { album: Album; year: number; count: number } | null = null
  for (const a of ctx.albums) {
    const plays = ctx.albumPlays.get(a.id) ?? []
    const byYear = new Map<number, number>()
    for (const t of plays) {
      const dt = new Date(t)
      if (dt.getMonth() === m && dt.getFullYear() < thisYear) {
        byYear.set(dt.getFullYear(), (byYear.get(dt.getFullYear()) ?? 0) + 1)
      }
    }
    for (const [year, count] of byYear) {
      if (count >= 5 && (!best || count > best.count)) best = { album: a, year, count }
    }
  }
  if (!best) return null

  return {
    id: 'this-month-that-year',
    category: 'temporal',
    headline: 'This Month, That Year',
    subheadline: `${MONTHS[m]} used to sound like this.`,
    metric: { value: String(best.count), label: `plays · ${MONTHS[m]} ${best.year}` },
    albums: [ctx.toCardAlbum(best.album)],
    cta: 'Put it on',
    narrativeScore: 0.7,
  }
}

const lateNight: CardGenerator = (ctx) => {
  const best = bestAlbum(ctx, (_a, plays) => {
    if (plays.length < 6) return 0
    const f = fraction(plays, (t) => hourOf(t) < 4)
    return f >= 0.5 ? f : 0
  })
  if (!best) return null
  return {
    id: 'late-night',
    category: 'temporal',
    headline: 'Late Night Records',
    subheadline: `A record that only ever comes out after midnight.`,
    metric: { value: `${pct(best.value)}%`, label: 'plays after midnight' },
    albums: [ctx.toCardAlbum(best.album)],
    cta: 'Put it on',
    narrativeScore: 0.8,
  }
}

const morningStack: CardGenerator = (ctx) => {
  const best = bestAlbum(ctx, (_a, plays) => {
    if (plays.length < 6) return 0
    const f = fraction(plays, (t) => hourOf(t) >= 6 && hourOf(t) < 9)
    return f >= 0.5 ? f : 0
  })
  if (!best) return null
  return {
    id: 'morning-stack',
    category: 'temporal',
    headline: 'Morning Stack',
    subheadline: `The one you reach for before the day starts.`,
    metric: { value: `${pct(best.value)}%`, label: 'plays before 9am' },
    albums: [ctx.toCardAlbum(best.album)],
    cta: 'Put it on',
    narrativeScore: 0.7,
  }
}

const weekendAlbums: CardGenerator = (ctx) => {
  const best = bestAlbum(ctx, (_a, plays) => {
    if (plays.length < 8) return 0
    const f = fraction(plays, (t) => dayOf(t) === 0 || dayOf(t) === 6)
    return f >= 0.5 ? f : 0
  })
  if (!best) return null
  return {
    id: 'weekend-albums',
    category: 'temporal',
    headline: 'Weekend Albums',
    subheadline: `Strictly a Saturday-and-Sunday kind of record.`,
    metric: { value: `${pct(best.value)}%`, label: 'plays at the weekend' },
    albums: [ctx.toCardAlbum(best.album)],
    cta: 'Put it on',
    narrativeScore: 0.6,
  }
}

const sundayAlbums: CardGenerator = (ctx) => {
  const best = bestAlbum(ctx, (_a, plays) => {
    if (plays.length < 8) return 0
    const f = fraction(plays, (t) => dayOf(t) === 0)
    return f >= 0.4 ? f : 0
  })
  if (!best) return null
  return {
    id: 'sunday-albums',
    category: 'temporal',
    headline: 'Sunday Albums',
    subheadline: `Something about this one says slow Sunday.`,
    metric: { value: `${pct(best.value)}%`, label: 'plays on a Sunday' },
    albums: [ctx.toCardAlbum(best.album)],
    cta: 'Put it on',
    narrativeScore: 0.6,
  }
}

/* ================================================================== */
/*  MILESTONE                                                         */
/* ================================================================== */

const almostThere: CardGenerator = (ctx) => {
  const thresholds = [50, 100, 200, 500]
  let best: { album: Album; gap: number; target: number } | null = null
  for (const a of ctx.albums) {
    if (a.play_count <= 0) continue
    for (const t of thresholds) {
      const gap = t - a.play_count
      if (gap > 0 && gap <= 10 && (!best || gap < best.gap)) {
        best = { album: a, gap, target: t }
        break
      }
    }
  }
  if (!best) return null
  return {
    id: 'almost-there',
    category: 'milestone',
    headline: 'Almost There',
    subheadline: `A handful of spins away from a milestone.`,
    metric: { value: String(best.gap), label: `plays from ${best.target}` },
    albums: [ctx.toCardAlbum(best.album)],
    cta: 'Close the gap',
    narrativeScore: 0.85,
  }
}

const centuryClub: CardGenerator = (ctx) => {
  const recentCut = ctx.now - 30 * DAY
  const best = bestAlbum(ctx, (a, plays) => {
    if (a.play_count < 100 || a.play_count > 130) return 0
    const recent = plays.some((t) => t >= recentCut)
    return recent ? a.play_count : 0
  })
  if (!best) return null
  return {
    id: 'century-club',
    category: 'milestone',
    headline: 'Century Club',
    subheadline: `Just tipped past a hundred plays — and still going.`,
    metric: { value: String(best.album.play_count), label: 'plays and counting' },
    albums: [ctx.toCardAlbum(best.album)],
    cta: 'Put it on',
    narrativeScore: 0.65,
  }
}

const firstListenFlashback: CardGenerator = (ctx) => {
  const best = bestAlbum(ctx, (_a, plays) => {
    if (plays.length === 0) return 0
    const first = plays[0]
    const age = ctx.now - first
    return age >= 5 * YEAR ? age : 0
  })
  if (!best) return null
  const year = new Date(best.plays[0]).getFullYear()
  const years = Math.round(best.value / YEAR)
  return {
    id: 'first-listen-flashback',
    category: 'milestone',
    headline: 'First Listen Flashback',
    subheadline: `You first pressed play on this a long time ago.`,
    metric: { value: String(year), label: `${years} years back` },
    albums: [ctx.toCardAlbum(best.album)],
    cta: 'Put it on',
    narrativeScore: 0.7,
  }
}

// One Hit Wonders / Deep Cut Ratio need per-track play distribution, which
// isn't cached (tracks are fetched per-album on demand). They stay dormant
// until track-level plays are cached library-wide.
const oneHitWonders: CardGenerator = () => null
const deepCutRatio: CardGenerator = () => null

/* ================================================================== */
/*  NEGLECT / RECENCY                                                 */
/* ================================================================== */

const forgottenGems: CardGenerator = (ctx) => {
  const cutoff = ctx.now - YEAR
  const candidates: { album: Album; last: number }[] = []
  for (const a of ctx.albums) {
    if (a.play_count < 40) continue
    const plays = ctx.albumPlays.get(a.id) ?? []
    if (plays.length === 0) continue // unknown recency — skip to stay honest
    const last = plays[plays.length - 1]
    if (last < cutoff) candidates.push({ album: a, last })
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.album.play_count - a.album.play_count)
  const months = Math.round((ctx.now - candidates[0].last) / (30 * DAY))
  return {
    id: 'forgotten-gems',
    category: 'neglect',
    headline: 'Forgotten Gems',
    subheadline: `You wore these out once. They've been quiet a long while.`,
    metric: { value: String(months), label: 'months untouched' },
    albums: candidates.slice(0, 6).map((c) => ctx.toCardAlbum(c.album)),
    cta: 'Hear the rest',
    narrativeScore: 0.9,
  }
}

const longHiatus: CardGenerator = (ctx) => {
  let best: { album: Album; gap: number } | null = null
  for (const a of ctx.albums) {
    const plays = ctx.albumPlays.get(a.id) ?? []
    if (plays.length < 3) continue
    let maxGap = 0
    for (let i = 1; i < plays.length; i++) {
      const g = plays[i] - plays[i - 1]
      if (g > maxGap) maxGap = g
    }
    const days = Math.round(maxGap / DAY)
    if (days >= 180 && (!best || days > best.gap)) best = { album: a, gap: days }
  }
  if (!best) return null
  return {
    id: 'long-hiatus',
    category: 'neglect',
    headline: 'Long Hiatus',
    subheadline: `You came back to this one after the longest silence.`,
    metric: { value: best.gap.toLocaleString(), label: 'days between plays' },
    albums: [ctx.toCardAlbum(best.album)],
    cta: 'Put it on',
    narrativeScore: 0.75,
  }
}

const oneSummer: CardGenerator = (ctx) => {
  const best = bestAlbum(ctx, (_a, plays) => {
    if (plays.length < 5) return 0
    const span = plays[plays.length - 1] - plays[0]
    const endedLongAgo = ctx.now - plays[plays.length - 1] >= YEAR
    return span <= 90 * DAY && endedLongAgo ? plays.length : 0
  })
  if (!best) return null
  const year = new Date(best.plays[0]).getFullYear()
  return {
    id: 'one-summer',
    category: 'neglect',
    headline: 'One Summer',
    subheadline: `A short, intense run — and then never again.`,
    metric: { value: String(year), label: 'and never since' },
    albums: [ctx.toCardAlbum(best.album)],
    cta: 'Relive it',
    narrativeScore: 0.8,
  }
}

const fadingFavourites: CardGenerator = (ctx) => {
  const twoYears = ctx.now - 2 * YEAR
  const oneYear = ctx.now - YEAR
  const sixMonths = ctx.now - 182 * DAY
  let best: { album: Album; then: number; recent: number } | null = null
  for (const a of ctx.albums) {
    const plays = ctx.albumPlays.get(a.id) ?? []
    if (plays.length < 8) continue
    let then = 0
    let recent = 0
    for (const t of plays) {
      if (t >= twoYears && t < oneYear) then++
      if (t >= sixMonths) recent++
    }
    if (then >= 8 && recent <= then * 0.25) {
      const drop = then - recent
      if (!best || drop > best.then - best.recent) best = { album: a, then, recent }
    }
  }
  if (!best) return null
  return {
    id: 'fading-favourites',
    category: 'neglect',
    headline: 'Fading Favourites',
    subheadline: `Top of the pile two years ago. Barely a spin lately.`,
    metric: { value: `${best.then}→${best.recent}`, label: 'plays, then vs now' },
    albums: [ctx.toCardAlbum(best.album)],
    cta: 'Put it back on',
    narrativeScore: 0.75,
  }
}

// Never Finished needs per-track play distribution (uncached) — dormant.
const neverFinished: CardGenerator = () => null

/* ================================================================== */
/*  GEOGRAPHY & ERA                                                   */
/* ================================================================== */

// All dormant: the schema has no artist country, no album release year, and
// no album duration cached (Track.duration exists but tracks aren't cached).
const fromSomewhereNew: CardGenerator = () => null
const decadeDeepDive: CardGenerator = () => null
const shortAndSweet: CardGenerator = () => null
const commitmentTest: CardGenerator = () => null

/* ================================================================== */
/*  LOVED TRACKS                                                      */
/* ================================================================== */

// All dormant: there is no "loved" field anywhere in the PocketBase schema.
const lovedButUnplayed: CardGenerator = () => null
const allKiller: CardGenerator = () => null
const sleeperLoved: CardGenerator = () => null

/* ================================================================== */
/*  CALCULATED                                                        */
/* ================================================================== */

const playsPerYear: CardGenerator = (ctx) => {
  // Ownership date isn't stored, so we proxy it with the earliest cached play.
  // BUT the play cache is capped at the most recent scrobbles, so for an older
  // album its early history is truncated and the first cached play looks recent
  // — which massively inflates an annualised rate (a long-owned album with 53
  // total plays reading as "398 plays per year owned"). Only trust the proxy
  // when the window holds essentially all of the album's plays, i.e. it really
  // is new to the shelf; otherwise skip it.
  const best = bestAlbum(ctx, (a, plays) => {
    if (a.play_count < 20 || plays.length === 0) return 0
    if (plays.length < a.play_count * 0.8) return 0 // history truncated → not new
    const owned = (ctx.now - plays[0]) / YEAR
    if (owned < 0.1 || owned > 2) return 0 // focus on recent fast burners
    return a.play_count / owned
  })
  if (!best) return null
  const owned = Math.max(0.1, (ctx.now - best.plays[0]) / YEAR)
  const rate = Math.round(best.album.play_count / owned)
  return {
    id: 'plays-per-year',
    category: 'calculated',
    headline: 'Fast Burner',
    subheadline: `Newer to the shelf, but you can't stop reaching for it.`,
    metric: { value: String(rate), label: 'plays per year owned' },
    albums: [ctx.toCardAlbum(best.album)],
    cta: 'Put it on',
    narrativeScore: 0.6,
  }
}

const theBSide: CardGenerator = (ctx) => {
  // Least-played album for each of the top artists (by summed album plays).
  const byArtist = new Map<string, Album[]>()
  for (const a of ctx.albums) {
    const arr = byArtist.get(a.artist)
    if (arr) arr.push(a)
    else byArtist.set(a.artist, [a])
  }
  const ranked = [...byArtist.entries()]
    .map(([artist, albums]) => ({
      artist,
      albums,
      total: albums.reduce((s, x) => s + (x.play_count || 0), 0),
    }))
    .filter((x) => x.albums.length >= 2 && x.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 6)

  const bsides: Album[] = []
  for (const g of ranked) {
    const played = g.albums.filter((a) => a.play_count > 0)
    if (played.length < 2) continue
    const least = played.reduce((m, a) => (a.play_count < m.play_count ? a : m))
    bsides.push(least)
  }
  if (bsides.length < 2) return null
  return {
    id: 'the-b-side',
    category: 'calculated',
    headline: 'The B-Side',
    subheadline: `Your favourite artists' most-overlooked records.`,
    albums: bsides.slice(0, 6).map((a) => ctx.toCardAlbum(a)),
    cta: 'Hear the rest',
    narrativeScore: 0.7,
  }
}

const theGrower: CardGenerator = (ctx) => {
  const best = bestAlbum(ctx, (_a, plays) => {
    if (plays.length < 10) return 0
    const first = plays[0]
    const last = plays[plays.length - 1]
    const span = last - first
    if (span < 90 * DAY) return 0
    const mid = first + span / 2
    let early = 0
    let late = 0
    for (const t of plays) (t < mid ? early++ : late++)
    if (early === 0) return 0
    const ratio = late / early
    return ratio >= 2 ? ratio : 0
  })
  if (!best) return null
  return {
    id: 'the-grower',
    category: 'calculated',
    headline: 'The Grower',
    subheadline: `Didn't grab you at first. Now you can't leave it alone.`,
    metric: { value: `${best.value.toFixed(1)}×`, label: 'more plays lately' },
    albums: [ctx.toCardAlbum(best.album)],
    cta: 'Put it on',
    narrativeScore: 0.7,
  }
}

/* ================================================================== */
/*  GENRE & WILDCARD — not tied to listening recency                  */
/* ================================================================== */

/** A few of the bigger genre shelves, rotated per shuffle. */
const genreSpotlight: CardGenerator = (ctx) => {
  const ranked = [...albumsByTag(ctx).entries()]
    .filter(([tag, list]) => !YEAR_TAG.test(tag) && list.length >= 4)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 24)
  if (ranked.length === 0) return null

  return pickDistinct(ranked, 3, ctx.rand).map(([tag, list]) => ({
    id: `genre-spotlight-${tag}`,
    category: 'genre' as const,
    headline: titleCase(tag),
    subheadline: `A wander through the ${tag} shelves.`,
    metric: { value: String(list.length), label: 'records in the crate' },
    albums: [...list].sort(byPlays).slice(0, 6).map(ctx.toCardAlbum),
    cta: 'Dig in',
    narrativeScore: 0.55,
  }))
}

/** One record pulled blind from a rotating genre crate. */
const luckyDip: CardGenerator = (ctx) => {
  const eligible = [...albumsByTag(ctx).entries()].filter(
    ([tag, l]) => !YEAR_TAG.test(tag) && l.length >= 3,
  )
  if (eligible.length === 0) return null

  return pickDistinct(eligible, 2, ctx.rand).map(([tag, list]) => {
    const album = list[Math.floor(ctx.rand() * list.length)]
    return {
      id: `lucky-dip-${tag}`,
      category: 'wildcard' as const,
      headline: 'Lucky Dip',
      subheadline: `Pulled blind from the ${tag} crate.`,
      metric:
        album.play_count > 0
          ? { value: String(album.play_count), label: 'plays so far' }
          : undefined,
      albums: [ctx.toCardAlbum(album)],
      cta: 'Put it on',
      narrativeScore: 0.5,
    }
  })
}

/** Six sleeves pulled at random from the whole crate. */
const blindPull: CardGenerator = (ctx) => {
  if (ctx.albums.length < 12) return null
  const picks = pickDistinct(ctx.albums, 6, ctx.rand)
  return {
    id: 'blind-pull',
    category: 'wildcard',
    headline: 'Blind Pull',
    subheadline: `Six sleeves grabbed at random. No agenda.`,
    albums: picks.map(ctx.toCardAlbum),
    cta: 'Take a chance',
    narrativeScore: 0.45,
  }
}

/**
 * Albums that first showed up in the crate a given year, rotated per shuffle.
 * "First showed up" = earliest cached play, so the span is bounded by the
 * play cache window — a release-year field on the backend would widen this.
 */
const classOf: CardGenerator = (ctx) => {
  const thisYear = new Date(ctx.now).getFullYear()
  const byYear = new Map<number, Album[]>()
  for (const a of ctx.albums) {
    const plays = ctx.albumPlays.get(a.id)
    if (!plays || plays.length === 0) continue
    const y = new Date(plays[0]).getFullYear()
    if (y >= thisYear) continue
    const arr = byYear.get(y)
    if (arr) arr.push(a)
    else byYear.set(y, [a])
  }
  const years = [...byYear.entries()].filter(([, list]) => list.length >= 4)
  if (years.length === 0) return null

  return pickDistinct(years, 2, ctx.rand).map(([year, list]) => ({
    id: `class-of-${year}`,
    category: 'temporal' as const,
    headline: `Class of ${year}`,
    subheadline: `Records that first hit the crate that year.`,
    metric: { value: String(list.length), label: 'new arrivals' },
    albums: [...list].sort(byPlays).slice(0, 6).map(ctx.toCardAlbum),
    cta: 'Revisit the intake',
    narrativeScore: 0.6,
  }))
}

/** Albums released a given year (via Last.fm year tags), rotated per shuffle. */
const pressedIn: CardGenerator = (ctx) => {
  const years = [...albumsByTag(ctx).entries()].filter(
    ([tag, list]) => YEAR_TAG.test(tag) && list.length >= 3,
  )
  if (years.length === 0) return null

  return pickDistinct(years, 2, ctx.rand).map(([year, list]) => ({
    id: `pressed-in-${year}`,
    category: 'temporal' as const,
    headline: `Pressed in ${year}`,
    subheadline: `Records from the year ${year} shelf.`,
    metric: { value: String(list.length), label: 'in the crate' },
    albums: [...list].sort(byPlays).slice(0, 6).map(ctx.toCardAlbum),
    cta: 'Spin the year',
    narrativeScore: 0.6,
  }))
}

/** Owned but barely explored — uses all-time play counts, not the cache window. */
const theUnderplayed: CardGenerator = (ctx) => {
  const candidates = ctx.albums.filter(
    (a) => a.play_count >= 1 && a.play_count <= 15,
  )
  if (candidates.length < 6) return null
  const picks = pickDistinct(candidates, 6, ctx.rand)
  return {
    id: 'the-underplayed',
    category: 'neglect',
    headline: 'The Underplayed',
    subheadline: `In the crate, barely cracked. Fewer than a handful of spins each.`,
    albums: picks.map(ctx.toCardAlbum),
    cta: 'Give one a shot',
    narrativeScore: 0.55,
  }
}

/** The artist you keep buying — most records in the crate. */
const theCompletist: CardGenerator = (ctx) => {
  const byArtist = new Map<string, Album[]>()
  for (const a of ctx.albums) {
    const arr = byArtist.get(a.artist)
    if (arr) arr.push(a)
    else byArtist.set(a.artist, [a])
  }
  const ranked = [...byArtist.entries()]
    .filter(([, list]) => list.length >= 4)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 8)
  if (ranked.length === 0) return null

  const [artistId, list] = pickDistinct(ranked, 1, ctx.rand)[0]
  const name = ctx.artistNameById.get(artistId) ?? 'Unknown'
  return {
    id: `the-completist-${artistId}`,
    category: 'calculated',
    headline: 'The Completist',
    subheadline: `You keep coming back for ${name}.`,
    metric: { value: String(list.length), label: 'records in the crate' },
    albums: [...list].sort(byPlays).slice(0, 6).map(ctx.toCardAlbum),
    cta: 'Line them up',
    narrativeScore: 0.6,
  }
}

/* ================================================================== */
/*  UNTAPPED SIGNALS — similar artists, global listeners, rare tags,   */
/*  sleeve notes, play-day streaks, seasonality                        */
/* ================================================================== */

/** Albums grouped by artist id. */
function albumsByArtist(ctx: EngineCtx): Map<string, Album[]> {
  const map = new Map<string, Album[]>()
  for (const a of ctx.albums) {
    const arr = map.get(a.artist)
    if (arr) arr.push(a)
    else map.set(a.artist, [a])
  }
  return map
}

/** Filed near a well-played artist: albums you own by their similar artists. */
const neighbours: CardGenerator = (ctx) => {
  // similar_artists entries could be ids, mbids or names — resolve any of them
  // to a library artist.
  const byMbid = new Map<string, Artist>()
  const byName = new Map<string, Artist>()
  for (const ar of ctx.artistById.values()) {
    if (ar.mbid) byMbid.set(ar.mbid, ar)
    if (ar.name) byName.set(ar.name.toLowerCase(), ar)
  }
  const resolve = (key: string): Artist | undefined => {
    const k = String(key).trim()
    return ctx.artistById.get(k) ?? byMbid.get(k) ?? byName.get(k.toLowerCase())
  }

  const albumsFor = albumsByArtist(ctx)

  const viable = [...ctx.artistById.values()]
    .filter(
      (a) =>
        a.play_count > 0 &&
        Array.isArray(a.similar_artists) &&
        a.similar_artists.length > 0,
    )
    .sort((a, b) => b.play_count - a.play_count)
    .slice(0, 25)
    .map((anchor) => {
      const seen = new Set<string>([anchor.id])
      const albums: Album[] = []
      for (const sim of anchor.similar_artists) {
        const neigh = resolve(sim)
        if (!neigh || seen.has(neigh.id)) continue
        seen.add(neigh.id)
        const their = albumsFor.get(neigh.id)
        if (their?.length) albums.push(...their)
      }
      return { anchor, albums }
    })
    .filter((x) => x.albums.length >= 2)

  if (viable.length === 0) return null
  const { anchor, albums } = pickDistinct(viable, 1, ctx.rand)[0]
  return {
    id: `neighbours-${anchor.id}`,
    category: 'calculated',
    headline: 'Neighbours',
    subheadline: `Filed near ${anchor.name} — kindred artists already in your crate.`,
    albums: [...albums].sort(byPlays).slice(0, 6).map(ctx.toCardAlbum),
    cta: 'Follow the thread',
    narrativeScore: 0.6,
  }
}

/** Your obscure favourite: high personal plays, few global listeners. */
const nobodyElseListens: CardGenerator = (ctx) => {
  let best: { album: Album; artist: Artist; ratio: number } | null = null
  for (const a of ctx.albums) {
    if (a.play_count < 15) continue
    const artist = ctx.artistById.get(a.artist)
    if (!artist || !artist.listener_count || artist.listener_count <= 0) continue
    if (artist.listener_count > 100_000) continue // genuinely under-the-radar only
    const ratio = a.play_count / artist.listener_count
    if (!best || ratio > best.ratio) best = { album: a, artist, ratio }
  }
  if (!best) return null
  return {
    id: 'nobody-else-listens',
    category: 'calculated',
    headline: 'Nobody Else Listens',
    subheadline: `You've worn this out. The rest of the world never found it.`,
    metric: {
      value: formatPlays(best.artist.listener_count),
      label: 'listeners worldwide',
    },
    albums: [ctx.toCardAlbum(best.album)],
    cta: 'Put it on',
    narrativeScore: 0.7,
  }
}

// Obvious non-genre Last.fm tags to keep out of "Rare Groove".
const NON_GENRE = new Set([
  'seen live', 'favourite', 'favourites', 'favorite', 'favorites', 'love',
  'albums i own', 'vinyl', 'spotify', 'beautiful', 'awesome', 'best',
  'check out', 'good', 'great', 'amazing', 'my music', 'owned',
])

/** A genre almost nothing else in the crate carries. */
const rareGroove: CardGenerator = (ctx) => {
  const rare = [...albumsByTag(ctx).entries()].filter(
    ([tag, list]) =>
      !YEAR_TAG.test(tag) &&
      tag.length >= 3 &&
      !NON_GENRE.has(tag) &&
      list.length >= 1 &&
      list.length <= 2,
  )
  if (rare.length === 0) return null
  return pickDistinct(rare, 2, ctx.rand).map(([tag, list]) => ({
    id: `rare-groove-${tag}`,
    category: 'genre' as const,
    headline: 'Rare Groove',
    subheadline:
      list.length === 1
        ? `The only ${tag} record in the whole crate.`
        : `One of just ${list.length} ${tag} records you own.`,
    metric: { value: String(list.length), label: `tagged ${tag}` },
    albums: [...list].sort(byPlays).slice(0, 6).map(ctx.toCardAlbum),
    cta: 'Put it on',
    narrativeScore: 0.55,
  }))
}

/** Leads with a line lifted from the album's write-up. */
const sleeveNotes: CardGenerator = (ctx) => {
  const withNotes = ctx.albums.filter((a) => (a.wiki_summary?.length ?? 0) > 160)
  if (withNotes.length === 0) return null
  const album = pickDistinct(withNotes, 1, ctx.rand)[0]
  return {
    id: 'sleeve-notes',
    category: 'wildcard',
    headline: 'Sleeve Notes',
    subheadline: `“${plainText(album.wiki_summary, 180)}”`,
    albums: [ctx.toCardAlbum(album)],
    cta: 'Put it on',
    narrativeScore: 0.5,
  }
}

/** An album you reached for on consecutive days. */
const dailyDriver: CardGenerator = (ctx) => {
  const dayIdx = (ms: number) => {
    const d = new Date(ms)
    return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / DAY)
  }
  let best: { album: Album; streak: number } | null = null
  for (const a of ctx.albums) {
    const plays = ctx.albumPlays.get(a.id)
    if (!plays || plays.length < 4) continue
    const days = [...new Set(plays.map(dayIdx))].sort((x, y) => x - y)
    let run = 1
    let max = 1
    for (let i = 1; i < days.length; i++) {
      run = days[i] === days[i - 1] + 1 ? run + 1 : 1
      if (run > max) max = run
    }
    if (max >= 4 && (!best || max > best.streak)) best = { album: a, streak: max }
  }
  if (!best) return null
  return {
    id: 'daily-driver',
    category: 'temporal',
    headline: 'Daily Driver',
    subheadline: `There was a stretch where this went on every single day.`,
    metric: { value: String(best.streak), label: 'days in a row' },
    albums: [ctx.toCardAlbum(best.album)],
    cta: 'Put it on',
    narrativeScore: 0.7,
  }
}

/** An album whose plays cluster hard into one calendar month. */
const seasonal: CardGenerator = (ctx) => {
  let best: { album: Album; month: number; frac: number } | null = null
  for (const a of ctx.albums) {
    const plays = ctx.albumPlays.get(a.id)
    if (!plays || plays.length < 8) continue
    const months = new Array(12).fill(0)
    for (const t of plays) months[new Date(t).getMonth()]++
    let top = 0
    for (let m = 1; m < 12; m++) if (months[m] > months[top]) top = m
    const frac = months[top] / plays.length
    if (frac >= 0.45 && (!best || frac > best.frac)) best = { album: a, month: top, frac }
  }
  if (!best) return null
  return {
    id: 'seasonal',
    category: 'temporal',
    headline: `A ${MONTHS[best.month]} Record`,
    subheadline: `Something about this one only really lands in ${MONTHS[best.month]}.`,
    metric: { value: `${pct(best.frac)}%`, label: `of plays in ${MONTHS[best.month]}` },
    albums: [ctx.toCardAlbum(best.album)],
    cta: 'Put it on',
    narrativeScore: 0.65,
  }
}

/* ================================================================== */
/*  MORE VARIETY — single-session binges + tag/collection angles       */
/*  (chosen to work even when the play cache spans only a short window) */
/* ================================================================== */

const dayIndex = (ms: number) => {
  const d = new Date(ms)
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / DAY)
}

/** Non-year, non-junk genre tags for an album, lowercased. */
function genreTagsOf(a: Album): string[] {
  if (!Array.isArray(a.tags)) return []
  return a.tags
    .map((t) => String(t).trim().toLowerCase())
    .filter((t) => t.length >= 3 && !YEAR_TAG.test(t) && !NON_GENRE.has(t))
}

/** The most plays an album got in a single calendar day. */
const inOneSitting: CardGenerator = (ctx) => {
  let best: { album: Album; count: number } | null = null
  for (const a of ctx.albums) {
    const plays = ctx.albumPlays.get(a.id)
    if (!plays || plays.length < 5) continue
    const byDay = new Map<number, number>()
    for (const t of plays) {
      const d = dayIndex(t)
      byDay.set(d, (byDay.get(d) ?? 0) + 1)
    }
    let cnt = 0
    for (const c of byDay.values()) if (c > cnt) cnt = c
    if (cnt >= 5 && (!best || cnt > best.count)) best = { album: a, count: cnt }
  }
  if (!best) return null
  return {
    id: 'in-one-sitting',
    category: 'temporal',
    headline: 'In One Sitting',
    subheadline: `One day you just kept flipping it back to side A.`,
    metric: { value: String(best.count), label: 'plays in a single day' },
    albums: [ctx.toCardAlbum(best.album)],
    cta: 'Put it on',
    narrativeScore: 0.7,
  }
}

/** The most plays an album got across a single Sat–Sun weekend. */
const lostWeekend: CardGenerator = (ctx) => {
  const saturdayOf = (ms: number): number | null => {
    const d = new Date(ms)
    const day = d.getDay() // 0 Sun … 6 Sat
    if (day !== 0 && day !== 6) return null
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    return Math.floor((day === 6 ? midnight : midnight - DAY) / DAY)
  }
  let best: { album: Album; count: number } | null = null
  for (const a of ctx.albums) {
    const plays = ctx.albumPlays.get(a.id)
    if (!plays || plays.length < 5) continue
    const byWeekend = new Map<number, number>()
    for (const t of plays) {
      const s = saturdayOf(t)
      if (s == null) continue
      byWeekend.set(s, (byWeekend.get(s) ?? 0) + 1)
    }
    let cnt = 0
    for (const c of byWeekend.values()) if (c > cnt) cnt = c
    if (cnt >= 5 && (!best || cnt > best.count)) best = { album: a, count: cnt }
  }
  if (!best) return null
  return {
    id: 'lost-weekend',
    category: 'temporal',
    headline: 'Lost Weekend',
    subheadline: `This soundtracked one whole Saturday and Sunday.`,
    metric: { value: String(best.count), label: 'plays in one weekend' },
    albums: [ctx.toCardAlbum(best.album)],
    cta: 'Put it on',
    narrativeScore: 0.65,
  }
}

/** Albums sharing the most genre tags with a well-played anchor. */
const moreLikeThis: CardGenerator = (ctx) => {
  const anchors = ctx.albums
    .filter((a) => a.play_count > 0 && genreTagsOf(a).length >= 3)
    .sort(byPlays)
    .slice(0, 15)
  if (anchors.length === 0) return null
  const anchor = pickDistinct(anchors, 1, ctx.rand)[0]
  const anchorTags = new Set(genreTagsOf(anchor))
  const scored = ctx.albums
    .filter((a) => a.id !== anchor.id)
    .map((a) => ({ a, shared: genreTagsOf(a).filter((t) => anchorTags.has(t)).length }))
    .filter((x) => x.shared >= 2)
    .sort((x, y) => y.shared - x.shared || byPlays(x.a, y.a))
  if (scored.length < 2) return null
  return {
    id: `more-like-${anchor.id}`,
    category: 'calculated',
    headline: 'More Like This',
    subheadline: `Cut from the same cloth as ${anchor.title}.`,
    albums: scored.slice(0, 6).map((x) => ctx.toCardAlbum(x.a)),
    cta: 'Follow the thread',
    narrativeScore: 0.6,
  }
}

/** A genre with several records but hardly any plays — a neglected shelf. */
const shelfYouForgot: CardGenerator = (ctx) => {
  const eligible = [...albumsByTag(ctx).entries()]
    .filter(
      ([tag, list]) =>
        !YEAR_TAG.test(tag) && !NON_GENRE.has(tag) && tag.length >= 3 && list.length >= 4,
    )
    .map(([tag, list]) => ({
      tag,
      list,
      avg: list.reduce((s, a) => s + (a.play_count || 0), 0) / list.length,
    }))
    .filter((x) => x.avg <= 8)
    .sort((a, b) => a.avg - b.avg)
  if (eligible.length === 0) return null
  const pick = pickDistinct(eligible, 1, ctx.rand)[0]
  return {
    id: `shelf-forgot-${pick.tag}`,
    category: 'genre',
    headline: 'A Shelf You Forgot',
    subheadline: `Your ${pick.tag} records barely get pulled. Worth another look.`,
    metric: { value: String(pick.list.length), label: `${pick.tag}, hardly played` },
    albums: [...pick.list]
      .sort((a, b) => (a.play_count || 0) - (b.play_count || 0))
      .slice(0, 6)
      .map(ctx.toCardAlbum),
    cta: 'Dig in',
    narrativeScore: 0.6,
  }
}

/** Real artwork, hardly played — sell it on the sleeve alone. */
const judgeTheCover: CardGenerator = (ctx) => {
  const candidates = ctx.albums.filter((a) => a.image_url && a.play_count <= 5)
  if (candidates.length < 6) return null
  const pick = pickDistinct(candidates, 1, ctx.rand)[0]
  return {
    id: 'judge-the-cover',
    category: 'wildcard',
    headline: 'Judge the Cover',
    subheadline: `You've barely played it — but look at that sleeve.`,
    albums: [ctx.toCardAlbum(pick)],
    cta: 'Put it on',
    narrativeScore: 0.5,
  }
}

/* ================================================================== */
/*  Registry                                                          */
/* ================================================================== */

export const GENERATORS: CardGenerator[] = [
  // temporal
  onThisDay,
  thisMonthThatYear,
  lateNight,
  morningStack,
  weekendAlbums,
  sundayAlbums,
  // milestone
  almostThere,
  centuryClub,
  firstListenFlashback,
  oneHitWonders,
  deepCutRatio,
  // neglect
  forgottenGems,
  longHiatus,
  oneSummer,
  fadingFavourites,
  neverFinished,
  // geography & era
  fromSomewhereNew,
  decadeDeepDive,
  shortAndSweet,
  commitmentTest,
  // loved
  lovedButUnplayed,
  allKiller,
  sleeperLoved,
  // calculated
  playsPerYear,
  theBSide,
  theGrower,
  theCompletist,
  // genre & wildcard
  genreSpotlight,
  luckyDip,
  blindPull,
  classOf,
  pressedIn,
  theUnderplayed,
  // untapped signals
  neighbours,
  nobodyElseListens,
  rareGroove,
  sleeveNotes,
  dailyDriver,
  seasonal,
  // more variety — binges + tag/collection angles
  inOneSitting,
  lostWeekend,
  moreLikeThis,
  shelfYouForgot,
  judgeTheCover,
]

export type { DiscoveryCard }
