import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useLibrary } from '@/lib/useLibrary'
import { cn } from '@/lib/cn'
import { BottomNav, type Tab } from './BottomNav'
import { InstallButton } from './InstallButton'
import { ThemeToggle } from './ThemeToggle'
import { RefreshIcon } from './icons'
import { CratesTab } from './crates/CratesTab'
import { ArtistDetail } from './crates/ArtistDetail'
import { AlbumDetail } from './crates/AlbumDetail'
import { DiscoveryTab } from './discovery/DiscoveryTab'
import { TagsTab } from './tags/TagsTab'
import { TagDetail } from './tags/TagDetail'
import { StatsTab } from './stats/StatsTab'
import { RecentTab } from './recent/RecentTab'

type Detail =
  | { kind: 'artist'; id: string }
  | { kind: 'album'; id: string }
  | { kind: 'tag'; id: string }

const TAB_TITLES: Record<Tab, string> = {
  crates: 'Crates',
  discovery: 'Discovery',
  tags: 'Tags',
  stats: 'Stats',
  recent: 'Recent',
}

const newSeed = () => Math.floor(Math.random() * 0x7fffffff)

export default function App() {
  const { data, connection, syncing, refresh } = useLibrary()
  const [tab, setTab] = useState<Tab>('discovery')
  const [stack, setStack] = useState<Detail[]>([])
  // Kept here (App stays mounted) so the Discovery selection survives drilling
  // into a detail and pressing back. It only re-rolls when you deliberately
  // switch to the Discovery tab, or tap "Dig again".
  const [discoverySeed, setDiscoverySeed] = useState(newSeed)

  // Scroll offsets saved per stack depth, so Back returns you to where you
  // were in the list you drilled in from.
  const savedScroll = useRef<number[]>([])

  const push = useCallback((d: Detail) => {
    savedScroll.current.push(window.scrollY)
    setStack((s) => [...s, d])
  }, [])
  const back = useCallback(() => setStack((s) => s.slice(0, -1)), [])

  // After the view swaps: a freshly opened detail starts at the top; going
  // back restores the saved offset. Runs before paint, so there's no flicker.
  const depth = stack.length
  const prevDepth = useRef(0)
  useLayoutEffect(() => {
    if (depth > prevDepth.current) {
      window.scrollTo({ top: 0 })
    } else if (depth < prevDepth.current) {
      const restored = savedScroll.current.splice(depth)[0] ?? 0
      window.scrollTo({ top: restored })
    }
    prevDepth.current = depth
  }, [depth])
  const openArtist = useCallback((id: string) => push({ kind: 'artist', id }), [push])
  const openAlbum = useCallback((id: string) => push({ kind: 'album', id }), [push])
  const openTag = useCallback((id: string) => push({ kind: 'tag', id }), [push])

  const changeTab = useCallback((next: Tab) => {
    savedScroll.current = []
    setStack([])
    setTab(next)
    if (next === 'discovery') setDiscoverySeed(newSeed())
    window.scrollTo({ top: 0 })
  }, [])

  const detail = stack[stack.length - 1]

  return (
    <div className="min-h-dvh w-full">
      {detail ? (
        // Detail pages stay a readable column even on wide screens.
        <div className="pb-safe mx-auto max-w-2xl">
          {detail.kind === 'artist' && (
            <ArtistDetail
              data={data}
              artistId={detail.id}
              onBack={back}
              onOpenAlbum={openAlbum}
              onOpenTag={openTag}
            />
          )}
          {detail.kind === 'album' && (
            <AlbumDetail
              data={data}
              albumId={detail.id}
              onBack={back}
              onOpenArtist={openArtist}
              onOpenTag={openTag}
            />
          )}
          {detail.kind === 'tag' && (
            <TagDetail
              data={data}
              tagId={detail.id}
              onBack={back}
              onOpenArtist={openArtist}
              onOpenAlbum={openAlbum}
            />
          )}
        </div>
      ) : (
        <>
          <Masthead
            title={TAB_TITLES[tab]}
            connection={connection}
            syncing={syncing}
            onRefresh={refresh}
          />
          <main className="pb-safe px-4 pt-4 sm:px-6 lg:px-8">
            {tab === 'crates' && <CratesTab data={data} onOpenAlbum={openAlbum} />}
            {tab === 'discovery' && (
              <DiscoveryTab
                data={data}
                seed={discoverySeed}
                onReroll={() => setDiscoverySeed(newSeed())}
                onOpenAlbum={openAlbum}
              />
            )}
            {tab === 'tags' && <TagsTab data={data} onOpenTag={openTag} />}
            {tab === 'stats' && (
              <StatsTab data={data} onOpenArtist={openArtist} onOpenAlbum={openAlbum} />
            )}
            {tab === 'recent' && <RecentTab />}
          </main>
        </>
      )}

      <BottomNav active={tab} onChange={changeTab} />
    </div>
  )
}

function Masthead({
  title,
  connection,
  syncing,
  onRefresh,
}: {
  title: string
  connection: 'live' | 'cached' | 'empty'
  syncing: boolean
  onRefresh: () => void
}) {
  return (
    <header className="border-b-[1.5px] border-ink bg-paper-2 px-4 pb-3 pt-4 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="label text-ink-3 leading-none">Nostalge</p>
          <h1 className="stamp-title text-[2.5rem] leading-[0.8]">{title}</h1>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ConnectionFlag connection={connection} syncing={syncing} />
          <div className="flex items-center gap-2">
            <InstallButton />
            <ThemeToggle />
            <button
              onClick={onRefresh}
              disabled={syncing}
              aria-label="Refresh from server"
              className="btn-press grid h-9 w-9 place-items-center disabled:opacity-50"
            >
              <RefreshIcon className={cn('h-4 w-4', syncing && 'animate-spin')} />
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}

function ConnectionFlag({
  connection,
  syncing,
}: {
  connection: 'live' | 'cached' | 'empty'
  syncing: boolean
}) {
  if (syncing) {
    return <span className="label text-ink-3">syncing…</span>
  }
  const map = {
    live: { text: 'live', cls: 'bg-riso-olive text-paper' },
    cached: { text: 'off the shelf', cls: 'bg-riso-yellow text-ink' },
    empty: { text: 'no signal', cls: 'bg-ink text-paper' },
  } as const
  const f = map[connection]
  return (
    <span
      className={cn('label border-[1.5px] border-ink px-1.5 py-[2px] leading-none', f.cls)}
    >
      {f.text}
    </span>
  )
}
