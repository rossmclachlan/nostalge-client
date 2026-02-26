import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import ArtistsPage from './pages/ArtistsPage'
import AlbumsPage from './pages/AlbumsPage'
import ActivityPage from './pages/ActivityPage'

function NavIcon({ path, label, children }: { path: string; label: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={path}
      className={({ isActive }) =>
        `flex flex-col items-center gap-1 px-3 py-2 text-xs transition-colors ${
          isActive ? 'text-primary' : 'text-text-muted hover:text-text'
        }`
      }
    >
      {children}
      <span>{label}</span>
    </NavLink>
  )
}

export default function App() {
  return (
    <div className="flex flex-col h-full">
      <main className="flex-1 overflow-y-auto pb-16">
        <Routes>
          <Route path="/" element={<Navigate to="/artists" replace />} />
          <Route path="/artists" element={<ArtistsPage />} />
          <Route path="/albums" element={<AlbumsPage />} />
          <Route path="/activity" element={<ActivityPage />} />
        </Routes>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-surface-light border-t border-surface-lighter flex justify-around safe-bottom">
        <NavIcon path="/artists" label="Artists">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </NavIcon>
        <NavIcon path="/albums" label="Albums">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        </NavIcon>
        <NavIcon path="/activity" label="Activity">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </NavIcon>
      </nav>
    </div>
  )
}
