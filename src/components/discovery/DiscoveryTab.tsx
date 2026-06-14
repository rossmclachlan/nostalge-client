import { useMemo, useState } from 'react'
import type { MusicData } from '@/lib/types'
import { deriveDiscovery, type AlbumWithArtist } from '@/lib/derive'
import { formatPlays, relativeAge } from '@/lib/format'
import { Cover } from '../Cover'
import { EmptyState, SectionHeader } from '../ui'

const newSeed = () => Math.floor(Math.random() * 0x7fffffff)

/* A rotating set of "why not today?" prompts. */
const PROMPTS = [
  'When did you last drop the needle on this?',
  'Gathering dust on the shelf.',
  'You loved this once.',
  'Overdue for a spin.',
  'Filed and forgotten.',
  'Pull it back out?',
]
function promptFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return PROMPTS[h % PROMPTS.length]
}

export function DiscoveryTab({
  data,
  onOpenAlbum,
  onOpenArtist,
}: {
  data: MusicData
  onOpenAlbum: (id: string) => void
  onOpenArtist: (id: string) => void
}) {
  // A fresh seed per mount means a different selection each time you land on
  // the tab; "dig again" re-rolls it without leaving.
  const [seed, setSeed] = useState(newSeed)
  const d = useMemo(() => deriveDiscovery(data, seed), [data, seed])

  const nothing =
    d.forgottenAlbums.length === 0 &&
    d.forgottenArtists.length === 0 &&
    d.blindAlbums.length === 0 &&
    d.blindArtists.length === 0

  if (nothing) {
    return (
      <EmptyState
        title="Nothing to dig up"
        body="Once there's some listening history to work from, the records you've been neglecting will surface here."
      />
    )
  }

  return (
    <div className="space-y-10">
      <div className="flex justify-end">
        <button onClick={() => setSeed(newSeed())} className="btn-press px-3 py-1.5 text-xs">
          ↻ Dig again
        </button>
      </div>

      {/* Forgotten Gems */}
      {(d.forgottenAlbums.length > 0 || d.forgottenArtists.length > 0) && (
        <section>
          <SectionHeader kicker="not played in 6+ months" title="Forgotten Gems" />
          <p className="mb-4 text-sm text-ink-2">
            Records you've worn out before, quietly gathering dust.
          </p>

          <div className="grid grid-cols-2 gap-3.5">
            {d.forgottenAlbums.map((album, i) => (
              <ForgottenAlbumCard
                key={album.id}
                album={album}
                tilt={i % 2 === 0 ? 'tilt-l' : 'tilt-r'}
                onClick={() => onOpenAlbum(album.id)}
              />
            ))}
          </div>

          {d.forgottenArtists.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {d.forgottenArtists.slice(0, 12).map((a) => (
                <button
                  key={a.id}
                  onClick={() => onOpenArtist(a.id)}
                  className="btn-press px-2.5 py-1 text-sm"
                >
                  {a.name}
                  <span className="label text-ink-3 ml-1.5">
                    {formatPlays(a.play_count)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Blind Spot */}
      {(d.blindAlbums.length > 0 || d.blindArtists.length > 0) && (
        <section>
          <SectionHeader kicker="0 plays · still in the shrink-wrap" title="Blind Spot" />
          <p className="mb-4 text-sm text-ink-2">
            You filed these away and never played them. No time like today.
          </p>

          <div className="grid grid-cols-2 gap-3.5">
            {d.blindAlbums.map((album, i) => (
              <button
                key={album.id}
                onClick={() => onOpenAlbum(album.id)}
                className="flyer block p-2 text-left transition-transform active:translate-y-[2px] active:shadow-none"
              >
                <div className={i % 2 === 0 ? 'tilt-r' : 'tilt-l'}>
                  <Cover name={album.title} src={album.image_url} />
                </div>
                <h3 className="font-display mt-2 text-lg leading-none text-ink uppercase line-clamp-2">
                  {album.title}
                </h3>
                <p className="label text-ink-3 mt-1 truncate">{album.artistName}</p>
                <p className="mt-1 text-[0.7rem] italic text-riso-red">
                  never spun
                </p>
              </button>
            ))}
          </div>

          {d.blindArtists.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {d.blindArtists.slice(0, 12).map((a) => (
                <button
                  key={a.id}
                  onClick={() => onOpenArtist(a.id)}
                  className="btn-press px-2.5 py-1 text-sm"
                >
                  {a.name}
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function ForgottenAlbumCard({
  album,
  tilt,
  onClick,
}: {
  album: AlbumWithArtist
  tilt: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flyer block p-2 text-left transition-transform active:translate-y-[2px] active:shadow-none"
    >
      <div className={tilt}>
        <Cover name={album.title} src={album.image_url} />
      </div>
      <h3 className="font-display mt-2 text-lg leading-none text-ink uppercase line-clamp-2">
        {album.title}
      </h3>
      <p className="label text-ink-3 mt-1 truncate">{album.artistName}</p>
      <p className="mt-1 text-[0.7rem] italic text-ink-2">
        {album.lastPlayed
          ? `last spun ${relativeAge(new Date(album.lastPlayed).toISOString())}`
          : promptFor(album.id)}
      </p>
    </button>
  )
}
