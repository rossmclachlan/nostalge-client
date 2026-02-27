import { useRef, useEffect, useCallback } from 'react'

const THRESHOLD = 80
const MAX_PULL = 120

interface PullToRefreshOptions {
  onRefresh: () => Promise<void> | void
  containerRef: React.RefObject<HTMLElement | null>
}

export default function usePullToRefresh({ onRefresh, containerRef }: PullToRefreshOptions) {
  const startY = useRef(0)
  const pulling = useRef(false)
  const refreshing = useRef(false)
  const indicatorRef = useRef<HTMLDivElement | null>(null)

  const createIndicator = useCallback(() => {
    if (indicatorRef.current) return indicatorRef.current
    const el = document.createElement('div')
    el.className = 'pull-to-refresh-indicator'
    el.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`
    containerRef.current?.parentElement?.insertBefore(el, containerRef.current)
    indicatorRef.current = el
    return el
  }, [containerRef])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function onTouchStart(e: TouchEvent) {
      if (refreshing.current) return
      if (container!.scrollTop <= 0) {
        startY.current = e.touches[0].clientY
        pulling.current = true
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (!pulling.current || refreshing.current) return
      const dy = e.touches[0].clientY - startY.current
      if (dy < 0) {
        pulling.current = false
        return
      }

      const distance = Math.min(dy * 0.5, MAX_PULL)
      if (distance > 10) {
        e.preventDefault()
        const indicator = createIndicator()
        indicator.style.height = `${distance}px`
        indicator.style.opacity = String(Math.min(distance / THRESHOLD, 1))

        const svg = indicator.querySelector('svg')
        if (svg) {
          const rotation = (distance / THRESHOLD) * 360
          svg.style.transform = `rotate(${rotation}deg)`
          if (distance >= THRESHOLD) {
            svg.style.color = 'var(--primary)'
          } else {
            svg.style.color = 'var(--muted-foreground)'
          }
        }
      }
    }

    async function onTouchEnd() {
      if (!pulling.current || refreshing.current) return
      pulling.current = false

      const indicator = indicatorRef.current
      if (!indicator) return

      const height = parseFloat(indicator.style.height || '0')

      if (height >= THRESHOLD) {
        refreshing.current = true
        indicator.style.height = '48px'
        indicator.classList.add('refreshing')
        const svg = indicator.querySelector('svg')
        if (svg) svg.style.animation = 'spin 0.8s linear infinite'

        try {
          await onRefresh()
        } finally {
          refreshing.current = false
          if (svg) svg.style.animation = ''
          indicator.classList.remove('refreshing')
        }
      }

      indicator.style.height = '0px'
      indicator.style.opacity = '0'
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      indicatorRef.current?.remove()
      indicatorRef.current = null
    }
  }, [containerRef, onRefresh, createIndicator])
}
