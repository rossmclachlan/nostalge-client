import { useRef, useCallback } from 'react'
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { User, Disc3, Clock, Tag, Compass } from 'lucide-react'
import { cn } from '@/lib/utils'
import ArtistsPage from '@/pages/ArtistsPage'
import ArtistDetailPage from '@/pages/ArtistDetailPage'
import AlbumsPage from '@/pages/AlbumsPage'
import AlbumDetailPage from '@/pages/AlbumDetailPage'
import ActivityPage from '@/pages/ActivityPage'
import TagsPage from '@/pages/TagsPage'
import TagDetailPage from '@/pages/TagDetailPage'
import DiscoverPage from '@/pages/DiscoverPage'
import InstallPrompt from '@/components/InstallPrompt'
import PageTransition from '@/components/PageTransition'
import usePullToRefresh from '@/hooks/usePullToRefresh'
import ScrollToTop from '@/components/ScrollToTop'

function NavItem({ path, label, icon: Icon }: { path: string; label: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <NavLink
      to={path}
      className={({ isActive }) =>
        cn(
          'flex flex-col items-center gap-1 px-3 py-2 text-xs transition-colors',
          isActive
            ? 'text-primary'
            : 'text-muted-foreground hover:text-foreground',
        )
      }
    >
      <Icon className="h-5 w-5" />
      <span>{label}</span>
    </NavLink>
  )
}

export default function App() {
  const mainRef = useRef<HTMLElement>(null)
  const location = useLocation()
  const navigate = useNavigate()

  const handleRefresh = useCallback(async () => {
    // Re-navigate to the same path to trigger a re-mount/re-fetch
    navigate(location.pathname, { replace: true })
    // Small delay so the user sees the refresh indicator
    await new Promise(r => setTimeout(r, 300))
  }, [location.pathname, navigate])

  usePullToRefresh({ onRefresh: handleRefresh, containerRef: mainRef })

  return (
    <div className="flex h-full flex-col">
      <main ref={mainRef} className="flex-1 overflow-y-auto pb-16">
        <ScrollToTop />
        <PageTransition>
          <Routes location={location}>
            <Route path="/" element={<Navigate to="/artists" replace />} />
            <Route path="/artists" element={<ArtistsPage />} />
            <Route path="/artists/:id" element={<ArtistDetailPage />} />
            <Route path="/albums" element={<AlbumsPage />} />
            <Route path="/albums/:id" element={<AlbumDetailPage />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/tags/:id" element={<TagDetailPage />} />
            <Route path="/discover" element={<DiscoverPage />} />
            <Route path="/activity" element={<ActivityPage />} />
          </Routes>
        </PageTransition>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 flex justify-around border-t border-border bg-card safe-bottom">
        <NavItem path="/artists" label="Artists" icon={User} />
        <NavItem path="/albums" label="Albums" icon={Disc3} />
        <NavItem path="/discover" label="Discover" icon={Compass} />
        <NavItem path="/tags" label="Tags" icon={Tag} />
        <NavItem path="/activity" label="Activity" icon={Clock} />
      </nav>

      <InstallPrompt />
    </div>
  )
}
