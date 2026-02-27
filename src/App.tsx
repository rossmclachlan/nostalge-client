import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { User, Disc3, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import ArtistsPage from '@/pages/ArtistsPage'
import ArtistDetailPage from '@/pages/ArtistDetailPage'
import AlbumsPage from '@/pages/AlbumsPage'
import ActivityPage from '@/pages/ActivityPage'

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
  return (
    <div className="flex h-full flex-col">
      <main className="flex-1 overflow-y-auto pb-16">
        <Routes>
          <Route path="/" element={<Navigate to="/artists" replace />} />
          <Route path="/artists" element={<ArtistsPage />} />
          <Route path="/artists/:id" element={<ArtistDetailPage />} />
          <Route path="/albums" element={<AlbumsPage />} />
          <Route path="/albums/:id" element={<AlbumsPage />} />
          <Route path="/activity" element={<ActivityPage />} />
        </Routes>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 flex justify-around border-t border-border bg-card safe-bottom">
        <NavItem path="/artists" label="Artists" icon={User} />
        <NavItem path="/albums" label="Albums" icon={Disc3} />
        <NavItem path="/activity" label="Activity" icon={Clock} />
      </nav>
    </div>
  )
}
