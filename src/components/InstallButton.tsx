import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * Shows an "Add to home screen" button only when the browser says the app
 * is installable (Android / Chromium fire `beforeinstallprompt`). Hides
 * itself once installed or if the platform never offers it.
 */
export function InstallButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault() // stop Chrome's default mini-infobar
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setDeferred(null)

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (!deferred) return null

  const install = async () => {
    await deferred.prompt()
    await deferred.userChoice
    setDeferred(null) // can only be used once
  }

  return (
    <button onClick={install} className="btn-press bg-sun px-3 py-1.5 text-xs">
      Install
    </button>
  )
}
