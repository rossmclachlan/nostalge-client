import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLibrary } from '@/lib/useLibrary'
import { cn } from '@/lib/cn'
import { BottomNav, type Tab } from './BottomNav'
import { InstallButton } from './InstallButton'
import { Seal } from './Seal'
import { GridIcon, RefreshIcon, StreamIcon } from './icons'
import { CratesTab } from './crates/CratesTab'
import { ArtistDetail } from './crates/ArtistDetail'
import { AlbumDetail } from './crates/AlbumDetail'
import { DiscoveryTab, type DiscoveryView } from './discovery/DiscoveryTab'
import { TagsTab } from './tags/TagsTab'
import { TagDetail } from './tags/TagDetail'
import { StatsTab } from './stats/StatsTab'
import { RecentTab } from './recent/RecentTab'
import { SegmentedControl } from './ui'
import { SignInGate } from './SignIn'

type Detail =
  | { kind: 'artist'; id: string }
  | { kind: 'album'; id: string }
  | { kind: 'tag'; id: string }

const TAB_TITLES: Record<Tab, string> = {
  discovery: 'Discover',
  library: 'Library',
  history: 'History',
}

/** The two views inside the Library tab. */
type LibrarySection = 'crates' | 'tags'
const LIBRARY_SECTIONS: { id: LibrarySection; label: string }[] = [
  { id: 'crates', label: 'Crates' },
  { id: 'tags', label: 'Tags' },
]

/** The two views inside the History tab. */
type HistorySection = 'recent' | 'stats'
const HISTORY_SECTIONS: { id: HistorySection; label: string }[] = [
  { id: 'recent', label: 'Recent' },
  { id: 'stats', label: 'Stats' },
]

const newSeed = () => Math.floor(Math.random() * 0x7fffffff)

const VIEW_KEY = 'nostalge:discover-view:v1'

/** The Wall is the default; Stream is remembered once picked. */
function loadView(): DiscoveryView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'stream' ? 'stream' : 'wall'
  } catch {
    return 'wall'
  }
}

// The Sets tab is gone (playlists are built through the Claude connector now).
// Clear what it left in the browser, the Gemini API key above all.
try {
  // The app is light only now, so the old theme choice goes too.
  for (const k of [
    'nostalge:gemini-key:v1',
    'nostalge:anthropic-key:v1',
    'nostalge:playlists:v1',
    'nostalge:theme',
  ]) {
    localStorage.removeItem(k)
  }
} catch {
  // Storage blocked; nothing to clean.
}

export default function App() {
  const { data, connection, syncing, needsSignIn, refresh } = useLibrary()
  const [tab, setTab] = useState<Tab>('discovery')
  const [stack, setStack] = useState<Detail[]>([])
  // Kept here (App stays mounted) so the Discovery selection survives drilling
  // into a detail and pressing back. It only re-rolls when you deliberately
  // switch to the Discovery tab, or tap "Dig again".
  const [discoverySeed, setDiscoverySeed] = useState(newSeed)
  const [discoveryView, setDiscoveryView] = useState<DiscoveryView>(loadView)
  const changeDiscoveryView = useCallback((next: DiscoveryView) => {
    setDiscoveryView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Storage blocked; the choice lasts this visit.
    }
  }, [])
  // Same reasoning as discoverySeed: kept in App so that drilling into an album
  // from Tags and pressing Back returns you to Tags, not to Crates.
  const [librarySection, setLibrarySection] = useState<LibrarySection>('crates')
  const [historySection, setHistorySection] = useState<HistorySection>('recent')

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

  /** Switching section is a navigation too — start the new view at the top. */
  const changeLibrarySection = useCallback((next: LibrarySection) => {
    setLibrarySection(next)
    window.scrollTo({ top: 0 })
  }, [])
  const changeHistorySection = useCallback((next: HistorySection) => {
    setHistorySection(next)
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
              onOpenArtist={openArtist}
              onOpenTag={openTag}
            />
          )}
          {detail.kind === 'album' && (
            <AlbumDetail
              data={data}
              albumId={detail.id}
              onBack={back}
              onOpenArtist={openArtist}
              onOpenAlbum={openAlbum}
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
            wordmark={tab === 'discovery'}
            connection={connection}
            syncing={syncing}
            onRefresh={refresh}
          >
            {tab === 'discovery' && (
              <ViewToggle value={discoveryView} onChange={changeDiscoveryView} />
            )}
          </Masthead>
          <main className="pb-safe px-4 pt-2 sm:px-6 lg:px-8">
            {needsSignIn && <SignInGate onSignedIn={refresh} />}

            {tab === 'discovery' && (
              <DiscoveryTab
                data={data}
                seed={discoverySeed}
                view={discoveryView}
                onReroll={() => setDiscoverySeed(newSeed())}
                onOpenAlbum={openAlbum}
              />
            )}

            {tab === 'library' && (
              <>
                <SegmentedControl
                  value={librarySection}
                  options={LIBRARY_SECTIONS}
                  onChange={changeLibrarySection}
                  className="mb-4"
                />
                {librarySection === 'crates' && (
                  <CratesTab data={data} onOpenAlbum={openAlbum} />
                )}
                {librarySection === 'tags' && <TagsTab data={data} onOpenTag={openTag} />}
              </>
            )}

            {tab === 'history' && (
              <>
                <SegmentedControl
                  value={historySection}
                  options={HISTORY_SECTIONS}
                  onChange={changeHistorySection}
                  className="mb-4"
                />
                {historySection === 'recent' && <RecentTab data={data} onOpenAlbum={openAlbum} />}
                {historySection === 'stats' && (
                  <StatsTab data={data} onOpenArtist={openArtist} onOpenAlbum={openAlbum} />
                )}
              </>
            )}
          </main>
        </>
      )}

      <BottomNav active={tab} onChange={changeTab} />
    </div>
  )
}

function Masthead({
  title,
  wordmark,
  connection,
  syncing,
  onRefresh,
  children,
}: {
  title: string
  /** Show the nostalge wordmark instead of the tab title (Discover). */
  wordmark: boolean
  connection: 'live' | 'cached' | 'empty'
  syncing: boolean
  onRefresh: () => void
  children?: ReactNode
}) {
  return (
    <header
      className="flex items-center gap-2 px-4 pb-2 sm:px-6 lg:px-8"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
    >
      <Seal className="h-[30px] w-[30px]" />
      {wordmark ? (
        <h1 className="text-[1.6rem] font-semibold text-indigo">nostalge</h1>
      ) : (
        <h1 className="text-[1.75rem]">{title}</h1>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        {children}
        <InstallButton />
        <button
          onClick={onRefresh}
          disabled={syncing}
          aria-label={`Refresh from server (${CONNECTION_TEXT[connection]})`}
          title={syncing ? 'syncing…' : CONNECTION_TEXT[connection]}
          className="relative grid h-11 w-11 place-items-center rounded-full text-ink active:bg-paper-3 disabled:opacity-60"
        >
          <RefreshIcon className={cn('h-5 w-5', syncing && 'animate-spin')} />
          {/* Where the data came from: live, the cache, or nothing yet. */}
          <span
            className={cn(
              'absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-[1.5px] border-paper',
              CONNECTION_DOT[connection],
            )}
          />
        </button>
      </div>
    </header>
  )
}

const CONNECTION_TEXT = {
  live: 'live',
  cached: 'off the shelf',
  empty: 'no signal',
} as const

const CONNECTION_DOT = {
  live: 'bg-riso-olive',
  cached: 'bg-sun',
  empty: 'bg-ink-3',
} as const

/** Wall / Stream switch for Discover. */
function ViewToggle({
  value,
  onChange,
}: {
  value: DiscoveryView
  onChange: (v: DiscoveryView) => void
}) {
  const options = [
    { id: 'wall' as const, label: 'Wall view', Icon: GridIcon },
    { id: 'stream' as const, label: 'Stream view', Icon: StreamIcon },
  ]
  return (
    <div role="group" aria-label="Discover layout" className="flex rounded-full border-[1.5px] border-kraft bg-paper-2 p-0.5">
      {options.map(({ id, label, Icon }) => {
        const on = value === id
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            aria-pressed={on}
            aria-label={label}
            className={cn(
              'grid h-8 w-9 place-items-center rounded-full transition-colors',
              on ? 'bg-indigo text-paper-2' : 'text-ink-3',
            )}
          >
            <Icon className="h-[18px] w-[18px]" />
          </button>
        )
      })}
    </div>
  )
}
