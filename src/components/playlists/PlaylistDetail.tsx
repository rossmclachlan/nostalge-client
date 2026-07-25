import { useMemo, useState } from 'react'
import { relativeAge } from '@/lib/format'
import { deletePlaylist, loadPlaylists } from '@/lib/playlist/store'
import type { Playlist } from '@/lib/playlist/types'
import { CopyButton } from '../CopyButton'
import { Cover } from '../Cover'
import { DetailHeader } from '../DetailHeader'
import { EmptyState } from '../ui'

/** The finished set: liner note, then the sequence with a line on each pick. */
export function PlaylistDetail({
  playlistId,
  onBack,
  onOpenAlbum,
}: {
  playlistId: string
  onBack: () => void
  onOpenAlbum: (id: string) => void
}) {
  const [gone, setGone] = useState(false)
  const playlist = useMemo(
    () => loadPlaylists().find((p) => p.id === playlistId) ?? null,
    [playlistId],
  )

  if (!playlist || gone) {
    return (
      <>
        <DetailHeader title="Playlist" onBack={onBack} />
        <div className="px-4 pt-4">
          <EmptyState
            title={gone ? 'Torn up' : 'Not on the shelf'}
            body={gone ? 'That set has been thrown out.' : 'This playlist is no longer saved.'}
          />
        </div>
      </>
    )
  }

  const remove = () => {
    deletePlaylist(playlist.id)
    setGone(true)
  }

  return (
    <>
      <DetailHeader title="Playlist" onBack={onBack} />

      <div className="px-4 pb-16 pt-4">
        <p className="label text-riso-red">“{playlist.prompt}”</p>
        <h1 className="stamp-title mt-1 text-[2.75rem] leading-[0.85]">{playlist.title}</h1>
        <p className="label text-ink-3 mt-2">
          {playlist.entries.length} tracks · {relativeAge(new Date(playlist.createdAt).toISOString())}
        </p>

        {playlist.linerNote && (
          <div className="flyer aged tilt-l mt-5 p-4">
            <p className="text-sm leading-relaxed text-ink">{playlist.linerNote}</p>
          </div>
        )}

        <ol className="mt-8 space-y-3">
          {playlist.entries.map((e, i) => (
            <li key={e.ref} className="flex items-start gap-3">
              <span className="font-display text-ink-3 w-6 shrink-0 pt-1 text-lg leading-none">
                {i + 1}
              </span>
              <button
                onClick={() => onOpenAlbum(e.albumId)}
                className="w-12 shrink-0"
                aria-label={`Open ${e.album}`}
              >
                <Cover name={e.album} src={e.imageUrl} className="sleeve-blend" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight text-ink">{e.track}</p>
                <p className="truncate text-xs text-ink-2">
                  {e.artist} — {e.album}
                </p>
                {e.reason && <p className="mt-1 text-xs italic text-ink-3">{e.reason}</p>}
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-10 flex items-center gap-2 border-t-[1.5px] border-ink pt-4">
          <CopyButton
            text={asText(playlist)}
            label="Copy tracklist"
            ariaLabel={`Copy the tracklist for ${playlist.title} to the clipboard`}
          />
          <button onClick={remove} className="btn-press px-2.5 py-1 text-xs">
            Throw it out
          </button>
        </div>
      </div>
    </>
  )
}

/** Plain text, for pasting into whatever actually plays the records. */
function asText(playlist: Playlist): string {
  const lines = [playlist.title, `"${playlist.prompt}"`, '']
  if (playlist.linerNote) lines.push(playlist.linerNote, '')
  playlist.entries.forEach((e, i) => {
    lines.push(`${i + 1}. ${e.track} — ${e.artist} (${e.album})`)
  })
  return lines.join('\n')
}
