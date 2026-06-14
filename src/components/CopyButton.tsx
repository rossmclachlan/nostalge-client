import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { CheckIcon, CopyIcon } from './icons'

/**
 * Copies `text` to the clipboard so it can be pasted into a streaming app.
 * Uses the async Clipboard API where available and falls back to a hidden
 * textarea + execCommand for older / non-secure contexts. Shows a brief
 * "Copied" confirmation, then resets.
 */
export function CopyButton({
  text,
  label = 'Copy',
  className,
}: {
  text: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copy = async () => {
    let ok = false
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      // Fallback for browsers without the async clipboard API.
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        // Deprecated, but the only option in non-secure contexts. Accessed
        // untyped to avoid the deprecation diagnostic.
        ok = (document as { execCommand: (c: string) => boolean }).execCommand('copy')
        document.body.removeChild(ta)
      } catch {
        ok = false
      }
    }
    if (!ok) return
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      onClick={copy}
      aria-label={`Copy "${text}" to clipboard`}
      className={cn(
        'btn-press inline-flex items-center gap-1.5 px-2.5 py-1 text-xs',
        copied && 'bg-riso-olive text-paper',
        className,
      )}
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" />
      )}
      {copied ? 'Copied' : label}
    </button>
  )
}
