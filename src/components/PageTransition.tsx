import { useLocation } from 'react-router-dom'
import { useRef, useEffect, useState } from 'react'

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const [displayChildren, setDisplayChildren] = useState(children)
  const [transitioning, setTransitioning] = useState(false)
  const prevKey = useRef(location.key)

  useEffect(() => {
    if (location.key !== prevKey.current) {
      prevKey.current = location.key
      setTransitioning(true)
      // Short fade out, then swap content and fade in
      const timer = setTimeout(() => {
        setDisplayChildren(children)
        setTransitioning(false)
      }, 100)
      return () => clearTimeout(timer)
    } else {
      setDisplayChildren(children)
    }
  }, [location.key, children])

  return (
    <div
      className={transitioning ? 'page-exit' : 'page-enter'}
    >
      {displayChildren}
    </div>
  )
}
